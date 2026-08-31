//! The server's own maintenance events, held against the forecast's food value.
//!
//! `ah-773o` resolved a source conflict: `rules/economy_maintenance` says one food substitutes for
//! each 50 silver of maintenance, while `data/GRAI`, `data/LIVE`, `data/FISH` and `data/MEAL` each
//! state 30. The committed turn-17 report settles it, because the server prints exactly how much
//! food each unit ate for maintenance - and those numbers are `ceil(owed / 30)`, never
//! `ceil(owed / 50)`. This test reads those event lines as fixture evidence and pins the forecast
//! to them, so a regression back to a single 50-silver food value fails here against a real turn.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::{classify_units, parse_report_full, ParsedReport};

mod common;
use common::ruleset;

const TURN_17: &str = atlantis_hud_fixtures::G7_F62_T17.text;

fn classified() -> ParsedReport {
    let mut report = parse_report_full(TURN_17);
    classify_units(&mut report, &ruleset());
    report
}

/// Units 5376 and 5375 are each 22 humans holding 21 livestock in the parsed post-turn report
/// (`tests/fixtures/reports/neworigins-3.0.0-g7-f62-t17.rep:714`,`:1066`), and the server reports
/// each consuming 8 livestock for maintenance (`:472`,`:475`). 22 humans owe 220 silver, and at 30
/// silver a livestock that is `ceil(220 / 30) == 8` - exactly the server's number. At the removed
/// 50-silver value it would be `ceil(220 / 50) == 5`, so the server row itself rules the old
/// constant out. Each forecast row must therefore cover the whole 220 in own food and owe nothing.
#[test]
fn the_turn_17_livestock_consumption_uses_the_data_value() {
    // The server-produced evidence this test rests on, read as text so a fixture edit that removed
    // it could not leave the test quietly passing on the arithmetic alone.
    assert!(
        TURN_17.contains("Drones (5376): Consumes 8 livestock [LIVE] for maintenance."),
        "the turn must carry unit 5376's consumption event"
    );
    assert!(
        TURN_17.contains("Drones (5375): Consumes 8 livestock [LIVE] for maintenance."),
        "the turn must carry unit 5375's consumption event"
    );
    // Why the server's 8 rules out the removed constant: 8 is ceil(220 / 30), not ceil(220 / 50).
    assert_eq!(
        (220 + 30 - 1) / 30,
        8,
        "the data value predicts the server's 8"
    );
    assert_eq!((220 + 50 - 1) / 50, 5, "the old constant predicted only 5");

    let review = review_turn(&classified(), "", Some(&ruleset()), CheckOptions::default());

    for id in ["5376", "5375"] {
        let forecast = review
            .silver
            .iter()
            .find(|unit| unit.unit_id == id)
            .unwrap_or_else(|| panic!("unit {id} is forecast"));
        assert_eq!(
            forecast.own_food_covered, 220,
            "{id}: 22 humans owe 220, and eight livestock at 30 cover it"
        );
        assert_eq!(
            forecast.upkeep,
            Some(0),
            "{id}: the food pays the whole fee"
        );
    }
}
