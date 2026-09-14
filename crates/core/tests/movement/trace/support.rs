use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

/// Traces one unit's orders over the current report alone.
///
/// The core takes the whole orders document rather than one unit's block (ah-048), because a unit
/// standing aboard a ship writes no order of its own - so these blocks are given the `unit` line
/// the editor's document always carries.
pub(super) fn trace(unit_id: &str, orders: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        TURN_71,
        "[]",
        unit_id,
        &document(unit_id, orders),
    )
    .expect("the ruleset loads")
}

/// One unit's block as a document: `unit <id>` and then the orders.
pub(super) fn document(unit_id: &str, orders: &str) -> String {
    format!("unit {unit_id}\n{orders}")
}

/// Traces one unit's orders over a report built in the test rather than committed.
pub(super) fn trace_over(text: &str, unit_id: &str, orders: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        text,
        "[]",
        unit_id,
        &document(unit_id, orders),
    )
    .expect("the ruleset loads")
}

/// The far hex, two levels down.
pub(super) fn far() -> atlantis_hud_core::report::model::Coordinate {
    atlantis_hud_core::report::model::Coordinate { x: 5, y: 5, z: 3 }
}
