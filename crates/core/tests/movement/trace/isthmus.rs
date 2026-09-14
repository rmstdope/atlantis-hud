use super::support::{document, trace_over};
use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};

/// The mockup's corridor as raw report text: `ocean (1,1)` —SE→ `plain (2,2)` —SE→ `ocean (3,3)`,
/// with the Longship in the first ocean hex. `structure` is dropped into the plain's block.
fn neck_report(structure: &str) -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    text.push_str(
        "  * Sailors (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n\n",
    );
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  North : ocean (2,0) in Sea.\n  \
         Southeast : ocean (3,3) in Sea.\n\n",
    );
    text.push_str(structure);
    if !structure.is_empty() {
        text.push('\n');
    }
    text.push_str("ocean (3,3) in Sea.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n\n");
    text.push_str("ocean (2,0) in Sea.\n\n");
    text.push_str("Exits:\n  South : plain (2,2) in Coast.\n");
    text
}

/// Traces over a report with a ruleset of the caller's choosing - `trace_over` above is hardwired
/// to New Origins, which has no canals.
fn trace_over_with(
    ruleset: &str,
    text: &str,
    unit_id: &str,
    orders: &str,
) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset,
        text,
        "[]",
        unit_id,
        &document(unit_id, orders),
    )
    .expect("the ruleset loads")
}

/// In through the plain's NW side and out through its SE one: the line is solid as far as the land
/// hex and dotted from the step that leaves it.
#[test]
fn a_traced_sail_through_a_neck_is_blocked_at_the_step_that_leaves() {
    let path = trace_over(&neck_report(""), "900", "SAIL SE SE")
        .path
        .expect("a traced path");

    assert_eq!(path.steps.len(), 2);
    assert_eq!(
        path.blocked_from,
        Some(1),
        "the step that leaves is refused"
    );
}

/// A canal lifts the restriction, so nothing is dotted.
#[test]
fn a_traced_sail_through_a_canal_is_not_blocked() {
    let path = trace_over_with(
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &neck_report("+ The Cut [3] : Canal.\n"),
        "900",
        "SAIL SE SE",
    )
    .path
    .expect("a traced path");

    assert_eq!(path.blocked_from, None, "a canal opens the neck");
}

/// The tracer keeps the premium where the rules charge it, which is what makes the months right: a
/// two-point fleet's first month ends inside the canal region.
#[test]
fn a_month_ends_inside_a_stone_canal() {
    let path = trace_over_with(
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &neck_report("+ The Cut [3] : Canal.\n").replace("MaxSpeed: 4", "MaxSpeed: 2"),
        "900",
        "SAIL SE SE",
    )
    .path
    .expect("a traced path");

    assert_eq!(path.months.len(), 2);
    assert_eq!(
        path.months[0].steps, 1,
        "two points buy the entry and no more"
    );
}

/// Turning out by a side beside the one it entered is legal, and drawn solid.
#[test]
fn a_traced_turn_beside_the_entry_side_is_not_blocked() {
    let path = trace_over(&neck_report(""), "900", "SAIL SE N")
        .path
        .expect("a traced path");

    assert_eq!(path.steps.len(), 2);
    assert_eq!(
        path.blocked_from, None,
        "N is beside the side it entered by"
    );
}
