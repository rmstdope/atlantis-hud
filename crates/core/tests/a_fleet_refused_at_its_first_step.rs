//! A fleet the game refuses at its very first step carries nobody anywhere, and every surface
//! says so together (`ah-8zqq`).
//!
//! Five fixes taught one consumer at a time where a sailing fleet ends the month (`ah-i6d0`,
//! `ah-jda3`, `ah-lz1g`, `ah-g0fk`, `ah-nz7r`); since `ah-8zqq` they all read
//! `movement::sailing::fleet_month_end`. This pins the agreement over one report: the captain and a
//! sailor stay, a passenger builds and another produces where they stand, and the preview moves
//! nobody.
//!
//! `rules/movement_sailing`: *"A fleet can move from an ocean region to another ocean region, or
//! from a coastal region to an ocean region, or from an ocean region to a coastal region."* The
//! fleet lies in the plain (1,1) and its owner sails SE into the forest (2,2): land at both ends,
//! so the game stops it before it takes a step.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, UnitPreviewStatus};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::parse_report_full;

mod common;

/// The settled plain (1,1), where the longship lies, and the unsettled forest (2,2) SE of it,
/// which grows no grain. Aboard: the captain (900) and a sailor (901), both on guard, a passenger
/// founding a Palace with its own stone (902) and a farmer (903). They weigh 140 together, within
/// the Longship's 150 (`newage trident data/LONG`): an overloaded fleet stays whatever its course
/// (`rules/movement_sailing`, `ah-zbtx`), and these tests are about the course.
const REPORT: &str = "Foo (1) Report\n\n\
plain (1,1) in Shire, contains Inholm [city], 1000 peasants (humans), $5000.\n\
------------------------------------------------------------\n\
\x20\x20Products: 200 grain [GRAI].\n\n\
Exits:\n\x20\x20Southeast : forest (2,2) in Shire.\n\n\
+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n\
\x20\x20* Captain (900), on guard, Foo (1), 4 humans [HUMN]. Weight: 40. Capacity: 0/0/60/0. \
Skills: sailing [SAIL] 2 (90).\n\
\x20\x20* Sailor (901), on guard, Foo (1), 2 humans [HUMN], 1000 silver [SILV]. Weight: 30. Capacity: \
0/0/30/0. Skills: sailing [SAIL] 2 (90).\n\
\x20\x20* Founder (902), Foo (1), human [HUMN], stone [STON]. Weight: 60. Capacity: 0/0/5/0. \
Skills: building [BUIL] 3 (180).\n\
\x20\x20* Farmer (903), Foo (1), human [HUMN]. Weight: 10. Capacity: 0/0/5/0. Skills: farming \
[FARM] 1 (30).\n\n\
forest (2,2) in Shire, 100 peasants (humans), $50.\n\
------------------------------------------------------------\n\
\x20\x20Products: 20 wood [WOOD].\n\n\
Exits:\n\x20\x20Northwest : plain (1,1) in Shire.\n\n";

const ORDERS: &str = "unit 900\nSAIL SE\n\
unit 901\nSAIL SE\n\
unit 902\nBUILD Palace\n\
unit 903\nPRODUCE grain\n";

fn review() -> TurnReview {
    review_of(REPORT)
}

fn review_of(report: &str) -> TurnReview {
    review_turn(
        &parse_report_full(report),
        ORDERS,
        Some(&common::trident_ruleset()),
        CheckOptions::default(),
    )
}

fn codes(review: &TurnReview) -> Vec<&str> {
    review
        .findings
        .iter()
        .map(|finding| finding.code.as_str())
        .collect()
}

#[test]
fn the_panel_warns_of_the_refused_step() {
    assert!(
        codes(&review()).contains(&"sail-between-land-hexes"),
        "{:?}",
        review().findings
    );
}

/// `guard-dropped` is said of the hex - "guarded by nobody next turn" - so the captain and the
/// sailor are asked one at a time: `report` with only `unit` on guard.
fn guarded_by_only(report: &str, unit: &str) -> String {
    let other = if unit == "900" {
        "Sailor (901)"
    } else {
        "Captain (900)"
    };
    report.replace(&format!("{other}, on guard,"), &format!("{other},"))
}

fn guard_dropped(report: &str) -> bool {
    review_of(report)
        .findings
        .iter()
        .any(|finding| finding.code.as_str() == "guard-dropped")
}

#[test]
fn the_captain_and_the_sailor_stay_to_guard_the_hex() {
    for unit in ["900", "901"] {
        assert!(
            !guard_dropped(&guarded_by_only(REPORT, unit)),
            "{unit} stays on guard"
        );
    }
}

#[test]
fn the_passenger_founds_in_the_settled_plain_it_stands_in() {
    let review = review();
    let refused: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "build-site-refused")
        .collect();
    assert!(refused.is_empty(), "{refused:?}");
}

#[test]
fn the_farmer_produces_grain_in_the_plain_it_stands_in() {
    assert!(
        !codes(&review()).contains(&"produce-not-here"),
        "{:?}",
        review().findings
    );
}

#[test]
fn the_preview_moves_nobody() {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        REPORT,
        "[]",
        ORDERS,
    )
    .expect("the ruleset loads");

    for region in &response.regions {
        for unit in &region.units {
            assert_eq!(
                unit.status,
                UnitPreviewStatus::Present,
                "{} stays put",
                unit.unit.unit_id
            );
        }
    }
    assert!(
        response
            .regions
            .iter()
            .all(|region| region.region_id != "1:2,2" || region.units.is_empty()),
        "nobody arrives in the forest"
    );
}

/// The control: the same fleet sailing into open water is not refused, so every check above has
/// something to say - which is what makes their silence over the forest mean the fleet stays.
#[test]
fn the_same_fleet_sailing_to_sea_carries_everybody_away() {
    let at_sea = REPORT
        .replace(
            "forest (2,2) in Shire, 100 peasants (humans), $50.",
            "ocean (2,2) in Sea.",
        )
        .replace(
            "Southeast : forest (2,2) in Shire.",
            "Southeast : ocean (2,2) in Sea.",
        )
        .replace("\x20\x20Products: 20 wood [WOOD].\n\n", "");
    let review = review_of(&at_sea);
    let codes = codes(&review);

    for unit in ["900", "901"] {
        assert!(
            guard_dropped(&guarded_by_only(&at_sea, unit)),
            "{unit} leaves"
        );
    }
    for expected in ["build-site-refused", "produce-not-here"] {
        assert!(codes.contains(&expected), "{expected}: {codes:?}");
    }
    assert!(!codes.contains(&"sail-between-land-hexes"), "{codes:?}");

    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &at_sea,
        "[]",
        ORDERS,
    )
    .expect("the ruleset loads");
    let departing: Vec<&str> = response
        .regions
        .iter()
        .flat_map(|region| &region.units)
        .filter(|unit| unit.status == UnitPreviewStatus::Departing)
        .map(|unit| unit.unit.unit_id.as_str())
        .collect();
    for unit in ["900", "901", "902", "903"] {
        assert!(departing.contains(&unit), "{unit}: {departing:?}");
    }
}
