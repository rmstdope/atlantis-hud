use super::support::document;
use crate::common::at;
use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};

/// The sea and the shore, with a Trident unit on the beach: `(2,2)` is coastal, `(3,3)` is deep -
/// its six neighbours are all water - and the unit is whatever `items` says it is.
fn trident_sea_and_shore(items: &str, weight: i64, capacity: &str) -> String {
    format!(
        "Foo (1) Report\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : ocean (2,2) in Atlantis Ocean.\n\n\
         * Swimmer (900), Foo (1), {items}. Weight: {weight}. Capacity: {capacity}.\n\n\
         ocean (2,2) in Atlantis Ocean.\n\n\
         Exits:\n  \
         Northwest : plain (1,1) in Nowhere.\n  \
         North : ocean (2,0) in Atlantis Ocean.\n  \
         Northeast : ocean (3,1) in Atlantis Ocean.\n  \
         Southeast : ocean (3,3) in Atlantis Ocean.\n  \
         South : ocean (2,4) in Atlantis Ocean.\n  \
         Southwest : ocean (1,3) in Atlantis Ocean.\n\n\
         ocean (3,3) in Atlantis Ocean.\n\n\
         Exits:\n  \
         North : ocean (3,1) in Atlantis Ocean.\n  \
         Northeast : ocean (4,2) in Atlantis Ocean.\n  \
         Southeast : ocean (4,4) in Atlantis Ocean.\n  \
         South : ocean (3,5) in Atlantis Ocean.\n  \
         Southwest : ocean (2,4) in Atlantis Ocean.\n  \
         Northwest : ocean (2,2) in Atlantis Ocean.\n"
    )
}

fn trace_trident(report: &str, orders: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        report,
        "[]",
        "900",
        &document("900", orders),
    )
    .expect("the committed Trident ruleset loads")
}

/// The dotted "the game would refuse this step" line has to agree with the planner: a lizardman
/// swims into coastal water, so nothing about that step is in doubt.
#[test]
fn a_typed_move_into_coastal_water_is_not_marked_refused() {
    let report = trident_sea_and_shore("lizardman [LIZA]", 10, "0/0/15/15");
    let path = trace_trident(&report, "MOVE SE")
        .path
        .expect("a traced path");

    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(2, 2));
    assert_eq!(path.blocked_from, None, "a swimmer swims coastal water");
}

/// Deep water is another matter: no sea creatures bear it, so the second step is refused.
#[test]
fn a_typed_move_into_deep_water_is_still_marked_refused() {
    let report = trident_sea_and_shore("lizardman [LIZA]", 10, "0/0/15/15");
    let path = trace_trident(&report, "MOVE SE SE")
        .path
        .expect("a traced path");

    assert_eq!(path.steps.len(), 2, "the path is still drawn to its end");
    assert_eq!(path.blocked_from, Some(1), "the deep hex is the doubt");
}
