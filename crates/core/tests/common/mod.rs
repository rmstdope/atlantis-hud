//! Shared helpers for `crates/core`'s integration tests. Not every test file uses every helper
//! here, so an unused one is expected rather than a mistake (ah-v2l).
#![allow(dead_code)]

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::effects::{OrdersPreviewResponse, UnitPreview};
use atlantis_hud_core::orders::intents::{read_intents, spends_the_month};
use atlantis_hud_core::report::model::Coordinate;

/// A map coordinate on the plane most fixtures live on.
pub fn at(x: i32, y: i32) -> Coordinate {
    Coordinate { x, y, z: 1 }
}

/// The shipped ruleset, parsed once per call.
pub fn ruleset() -> Ruleset {
    Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON).expect("the committed ruleset loads")
}

/// The committed Trident ruleset - the one world here that swims.
pub fn trident_ruleset() -> Ruleset {
    Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
        .expect("the committed Trident ruleset parses and validates")
}

/// The report's own orders template with the standing month-long orders of `units` dropped.
///
/// `rules/tax`, `rules/move` and `rules/study` each spend the unit's month, so a `PILLAGE`
/// written under a unit that still carries its template's `@tax`, `MOVE` or `@STUDY` never runs
/// and is told so instead (`ah-rzkm`). A player giving one of these units `PILLAGE` replaces its
/// standing month order; these fixtures say the same thing by dropping every one of them.
///
/// The crate's own reader and predicate decide what goes, rather than a keyword list copied into
/// test code that nothing would fail to update: `read_intents` skips `TURN` blocks, whose orders
/// belong to a later month, so those lines survive.
pub fn without_standing_month_orders(template: &str, units: &[&str]) -> String {
    let dropped: std::collections::BTreeSet<usize> = read_intents(template)
        .iter()
        .filter(|block| units.contains(&block.unit_id.as_str()))
        .flat_map(|block| block.intents.iter())
        .filter(|placed| spends_the_month(&placed.intent))
        .map(|placed| placed.line)
        .collect();

    template
        .lines()
        .enumerate()
        .filter(|(index, _)| !dropped.contains(&(index + 1)))
        .map(|(_, line)| line)
        .collect::<Vec<_>>()
        .join("\n")
}

/// The preview row for `unit_id`, or `None` when the orders change nothing about it.
///
/// The preview omits every unit its orders leave alone (`OrdersPreviewResponse`'s own doc), so an
/// absent row is an ordinary answer. It is only an answer, though, when the unit exists: this
/// panics when `unit_id` is not an own unit of `report_text` at all, so a fixture that reaches
/// nothing fails as a broken fixture rather than reading as "unchanged" (ah-z9g8).
pub fn preview_row<'a>(
    report_text: &str,
    response: &'a OrdersPreviewResponse,
    unit_id: &str,
) -> Option<&'a UnitPreview> {
    let report = ReportCache::new().classified(report_text, atlantis_hud_fixtures::RULESET_JSON);
    assert!(
        report.own_units().any(|unit| unit.unit_id == unit_id),
        "unit {unit_id} is not an own unit of the fixture report, so no orders can reach it - the fixture is broken, not the preview"
    );
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == unit_id)
}

/// As [`preview_row`], for a unit the orders are known to change: panics, naming which of the two
/// reasons it is, when there is no row.
pub fn expect_preview_row<'a>(
    report_text: &str,
    response: &'a OrdersPreviewResponse,
    unit_id: &str,
) -> &'a UnitPreview {
    preview_row(report_text, response, unit_id).unwrap_or_else(|| {
        panic!(
            "unit {unit_id} is an own unit of the report but has no preview row: the orders change nothing the preview shows about it"
        )
    })
}
