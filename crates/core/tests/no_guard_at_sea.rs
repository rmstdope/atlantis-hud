//! New Origins does not let a unit guard at sea (`ah-j04e`).
//!
//! `../Atlantis/neworigins/rules.cpp` sets `OCEAN_GUARD` to 0, and `Game::DoGuard1Orders`
//! (`../Atlantis/runorders.cpp`) clears the guard of every unit in a region whose terrain is
//! similar to ocean with "Can not guard in oceans." `rules/guard` itself says nothing about the
//! sea, so the engine is the source here.
//!
//! Ocean (44,12) of the committed turn 42: Longship [329] carries Sailors (11125) and (12590), two
//! centaurs of The Disinherited Knights (`neworigins-3.0.0-g3-f42-t42.rep:2280`).

use std::collections::BTreeSet;

use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

const SAILOR: &str = "12590";

/// The turn's own orders with `line` written into the Sailor's block.
fn orders(line: &str) -> String {
    let template = extract_orders_template(atlantis_hud_fixtures::G3_F42_T42.text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let header = format!("\nunit {SAILOR}\n");
    assert_eq!(template.matches(&header).count(), 1, "{header:?} once");
    template.replace(&header, &format!("{header}{line}\n"))
}

/// Every finding at ocean (44,12), with `hex-unguarded` switched on as the player had it.
fn at_sea(orders: &str) -> Vec<Finding> {
    at_sea_with(orders, Default::default())
}

/// Every finding at ocean (44,12), with only the codes in `disabled` switched off.
fn at_sea_with(orders: &str, disabled: BTreeSet<String>) -> Vec<Finding> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    let region_id = parsed
        .regions
        .iter()
        .find(|region| region.coordinate.x == 44 && region.coordinate.y == 12)
        .map(|region| region.region_id.clone())
        .expect("the fixture shows ocean (44,12)");
    let options = CheckOptions {
        disabled,
        ..CheckOptions::default()
    };
    review_turn(&parsed, orders, Some(&ruleset), options)
        .findings
        .into_iter()
        .filter(|finding| finding.region_id == region_id)
        .collect()
}

#[test]
fn an_ocean_hex_is_never_called_unguarded() {
    let findings = at_sea(&orders(""));
    assert!(
        findings
            .iter()
            .all(|finding| finding.code != codes::HEX_UNGUARDED),
        "{findings:#?}"
    );
}

#[test]
fn guard_1_at_sea_is_refused_because_it_is_at_sea() {
    let findings = at_sea(&orders("GUARD 1"));
    let refusals: Vec<_> = findings
        .iter()
        .filter(|finding| finding.unit_id.as_deref() == Some(SAILOR))
        .filter(|finding| finding.code == codes::GUARD_WITHOUT_TAX_ABILITY)
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(
        refusals,
        ["cannot guard: guarding at sea is not possible"],
        "{findings:#?}"
    );
}

/// Settings > Warnings says "Guards that cannot take watch" covers a unit at sea too (`ah-ah66`), so
/// switching it off silences this refusal as well as the one about taxing.
#[test]
fn switching_off_guards_that_cannot_take_watch_silences_the_refusal_at_sea() {
    let disabled = BTreeSet::from([codes::GUARD_WITHOUT_TAX_ABILITY.to_string()]);
    let findings = at_sea_with(&orders("GUARD 1"), disabled);
    assert!(
        findings
            .iter()
            .all(|finding| finding.code != codes::GUARD_WITHOUT_TAX_ABILITY),
        "{findings:#?}"
    );
}

/// The same report's land hexes are still called unguarded, so the absence above is the sea's and
/// not a check that has stopped speaking about this turn altogether.
#[test]
fn a_land_hex_of_the_same_turn_is_still_called_unguarded() {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    let options = CheckOptions {
        disabled: Default::default(),
        ..CheckOptions::default()
    };
    let unguarded: Vec<_> = review_turn(&parsed, &orders(""), Some(&ruleset), options)
        .findings
        .into_iter()
        .filter(|finding| finding.code == codes::HEX_UNGUARDED)
        .map(|finding| finding.region_id)
        .collect();
    let land = parsed
        .regions
        .iter()
        .find(|region| region.coordinate.x == 40 && region.coordinate.y == 0)
        .expect("the fixture shows (40,0)");
    assert!(
        ruleset.allows_guard_in(&land.terrain),
        "{} is land",
        land.terrain
    );
    assert!(
        unguarded.contains(&land.region_id),
        "{} in {unguarded:?}",
        land.region_id
    );
}
