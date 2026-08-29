//! What a hex yields is shared between the units producing there, checked against the game's own
//! answer for a whole hex on a real turn (`ah-256d`).
//!
//! A region's `Products` line states how much of each resource the hex holds this month, and every
//! unit producing there shares it: `rules/tableiteminfo` says *"If the units in a region attempt to
//! produce more of a commodity than can be produced that month, then the amount available is
//! distributed among the producers"*. The app modelled no pool at all, so after `ah-vtwn` fixed how
//! much one unit's men can make, the preview said 40 iron where the report said 20.
//!
//! `mountain (36,4)` of the committed turn 42 states `Products: 34 livestock [LIVE], 36 iron
//! [IRON], 16 stone [STON], 9 mithril [MITH], 6 admantium [ADMT]`
//! (`tests/fixtures/reports/neworigins-3.0.0-g3-f42-t42.rep:1341`), and six own units produce
//! there. Every figure asserted below is that report's own `Produces` line for the unit (`:508`
//! onwards) - the application's answer checked against the game's, which is a stronger statement
//! than any unit test in the bead.
//!
//! **Both columns, every row.** `semantics::produce` builds the ITEMS column and `forecast_unit`
//! (`orders/silver.rs`) builds the SILVER column, from arms that share only their inputs; they have
//! drifted before (`ah-ycuj`, `ah-abwx`, `ah-qct4`), so a settlement handed to one and not the
//! other is exactly the failure this file exists to catch.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// Each unit, the tag its `PRODUCE` names, and what the report's own `Produces` line says.
///
/// `Miners (1795)`'s 16 is the row that proves the pick bonus is inside the ask: without it the
/// unit asks 24 rather than 32, and 24 against 40 gives 13.
const EXPECTED: [(&str, &str, i64); 6] = [
    ("1795", "IRON", 16),
    ("5105", "IRON", 20),
    ("2693", "STON", 16),
    ("3493", "LIVE", 34),
    ("3826", "MITH", 9),
    ("7671", "ADMT", 6),
];

fn report() -> &'static str {
    atlantis_hud_fixtures::G3_F42_T42.text
}

/// The six `PRODUCE` orders turn 42 ran in `mountain (36,4)`, and nothing else.
///
/// **Written out rather than taken from the report's own template**, which already carries all six
/// (`:2746` onwards), for two reasons that pull the same way:
///
/// - *Appending to the template doubles every ITEMS figure.* A `PRODUCE` is month-long, so the
///   settlement counts each unit's first one and no more - but the ledger's `produce` still runs
///   per intent and credits a second line as well. That pre-existing double-count is `ah-o7td`'s
///   to fix, not this bead's, and a fixture that walks into it tests that rather than the
///   settlement.
/// - *Using the template alone hides four of the six rows.* It also carries a
///   `GIVE ... ALL <the same goods>` for `1795`, `2693`, `3826` and `7671`, and each of those
///   holds exactly what it produces - so the month's net item change is zero, and
///   `preview_orders_for_remembered_report` drops a unit whose changes are empty. The SILVER
///   column still answers, but the ITEMS half of the row would be asserting against a unit that
///   is not in the response at all.
fn orders() -> String {
    [
        "#atlantis 42 \"<password>\"",
        "",
        "unit 1795",
        "PRODUCE iron",
        "unit 5105",
        "PRODUCE iron",
        "unit 2693",
        "PRODUCE stone",
        "unit 3493",
        "PRODUCE livestock",
        "unit 3826",
        "PRODUCE mithril",
        "unit 7671",
        "PRODUCE admantium",
        "",
    ]
    .join("\n")
}

/// The ITEMS column's answer for each unit: how many of `tag` its `PRODUCE` makes this month.
fn items_column_produced() -> Vec<(String, i64)> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        report(),
        "[]",
        &orders(),
    )
    .expect("the ruleset loads");

    EXPECTED
        .iter()
        .map(|(id, tag, _)| {
            let made = response
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == *id)
                .map_or(0, |unit| {
                    unit.produced
                        .iter()
                        .filter(|produced| produced.tag == *tag)
                        .map(|produced| produced.amount)
                        .sum()
                });
            ((*id).to_string(), made)
        })
        .collect()
}

/// The SILVER column's answer for each unit.
fn silver_column_produced() -> Vec<(String, i64)> {
    let mut parsed = parse_report_full(report());
    classify_units(&mut parsed, &ruleset());
    let review = review_turn(
        &parsed,
        &orders(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    EXPECTED
        .iter()
        .map(|(id, _, _)| {
            let made = review
                .silver
                .iter()
                .find(|silver| silver.unit_id == *id)
                .map_or(0, |silver| silver.produced);
            ((*id).to_string(), made)
        })
        .collect()
}

/// The acceptance criterion of `ah-256d`: six units, two columns each, against the report's own
/// `Produces` lines.
#[test]
fn both_columns_match_the_reports_own_produces_lines() {
    let items = items_column_produced();
    let silver = silver_column_produced();

    for (index, (id, tag, expected)) in EXPECTED.iter().enumerate() {
        assert_eq!(
            items[index].1, *expected,
            "the ITEMS column for unit {id} producing {tag}: {}, and the report says {expected}",
            items[index].1
        );
        assert_eq!(
            silver[index].1, *expected,
            "the SILVER column for unit {id} producing {tag}: {}, and the report says {expected}",
            silver[index].1
        );
    }
}

/// The two iron miners' shares add to exactly what the hex yields, which is the fact the bead is
/// about: 36 iron, and not the 72 their men between them could make.
#[test]
fn the_hexs_iron_is_not_promised_twice() {
    let silver = silver_column_produced();
    let iron: i64 = silver
        .iter()
        .filter(|(id, _)| id == "1795" || id == "5105")
        .map(|(_, made)| made)
        .sum();

    assert_eq!(iron, 36, "the hex's Products line states 36 iron");
}
