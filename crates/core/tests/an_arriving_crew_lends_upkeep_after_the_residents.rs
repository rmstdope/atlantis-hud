//! At the hex a fleet sails into, the units already standing there lend for upkeep before the
//! arriving crew does (`ah-fpyo`).
//!
//! `neworigins-3.0.0-g5-f21-t24`: Raft [235] in Lonthax plain (36,44) carries its captain Drones
//! (10575, sharing, 2180 silver, `sail se ne`) and a passenger Drones (10594, 20 gnolls, no
//! silver) into ocean (38,44), where Raft [218] already holds Drones (9508, sharing, 680 silver)
//! and Drones (9579, 5 gnolls, no silver). Raft [236] (10584 + 10599) into (37,45), resident Drones
//! (9506), is the same case.
//!
//! `rules/sequenceofevents` assesses maintenance after movement and gives "units that appear
//! higher on the report" precedence; `rules/economy_maintenance` shares for it between units in
//! the same region. The engine appends an arriving fleet to the end of the region's objects
//! (`../Atlantis/object.cpp`: `Object::MoveObject`), so the residents are drawn on first. The real
//! turn 25 (`neworigins-3.0.0-g5-f21-t25`) shows it: 10575 goes 2180 -> 2160, its own upkeep only,
//! and 9508 pays everyone else's.
//!
//! The passenger's study, which the real turn also has 9508 lend, is `ah-q1zz`'s.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn review() -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn row_of(review: &TurnReview, unit_id: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .cloned()
        .unwrap_or_else(|| panic!("unit {unit_id} is forecast"))
}

/// Who each unit lent upkeep to, as the column's `lent for upkeep` lines name them.
fn lent_for_upkeep(row: &UnitSilver) -> Vec<(String, i64)> {
    row.changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::LentForUpkeep)
        .map(|change| (change.other.clone().unwrap_or_default(), change.amount))
        .collect()
}

/// What the SILVER column shows the unit ending the month with, maintenance paid and lent
/// (`packages/shared/src/unitTable.ts`: `atMonthEnd - upkeep - upkeepLent`).
fn ends_with(row: &UnitSilver) -> Option<i64> {
    Some(row.at_month_end? - row.upkeep? - row.upkeep_lent)
}

#[test]
fn the_resident_lends_the_upkeep_and_the_arriving_captain_none() {
    let review = review();
    for (captain, resident, passenger) in [("10575", "9508", "10594"), ("10584", "9506", "10599")] {
        let captain = row_of(&review, captain);
        let resident = row_of(&review, resident);
        assert_eq!(
            lent_for_upkeep(&captain),
            vec![],
            "the arriving captain lends none: {captain:#?}"
        );
        assert!(
            lent_for_upkeep(&resident).contains(&(format!("Drones ({passenger})"), -200)),
            "the resident lends the passenger's upkeep: {resident:#?}"
        );
        assert_eq!(
            ends_with(&captain),
            Some(2160),
            "turn 25: the captain pays its own upkeep only: {captain:#?}"
        );
    }
}

#[test]
fn the_resident_also_lends_its_raftmates_upkeep() {
    let review = review();
    assert_eq!(
        lent_for_upkeep(&row_of(&review, "9508")),
        vec![
            ("Drones (9579)".to_string(), -50),
            ("Drones (10594)".to_string(), -200),
        ]
    );
}
