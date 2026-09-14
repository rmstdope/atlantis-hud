use crate::common::at;
use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};

/// The map trace lexes under the world's rules: under Trident a `;` starts a comment wherever it
/// lands (`newage trident rules/orders`), so `MOVE SE;scouting` is a move south-east (`ah-xmqo`).
#[test]
fn a_trident_comment_on_a_move_line_still_draws_the_path() {
    let report = [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Walker (900), Foo (1), behind, leader [LEAD], 3 swords [SWOR]. Weight: 10. Capacity: 0/0/15/0.",
        "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n");
    let response = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &report,
        "[]",
        "900",
        "unit 900\nMOVE SE;scouting\n",
    )
    .expect("the Trident ruleset loads");
    let path = response.path.expect("the commented MOVE is still traced");
    assert_eq!(path.steps[0].to, at(2, 2));
}

/// A two-hex Trident world: Walker (900) stands at (1,1), with (2,2) to the southeast.
fn trident_walker_report() -> String {
    "Foo (1) Report

plain (1,1) in Nowhere, 10 peasants (orcs), $5.

Exits:
  Southeast : plain (2,2) in Nowhere.

* Walker (900), Foo (1), 5 orcs [ORC]. Weight: 50. Capacity: 0/0/75/0. Skills: none.

plain (2,2) in Nowhere, 10 peasants (orcs), $5.

Exits:
  Northwest : plain (1,1) in Nowhere.
"
    .to_string()
}

fn trace_trident_walker(orders_document: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &trident_walker_report(),
        "[]",
        "900",
        orders_document,
    )
    .expect("the ruleset loads")
}

/// Trident's `rules/orders`: "A semicolon ends whatever word it lands in, so it starts a comment
/// wherever it appears" - so `unit 900;the walker` names unit 900, and its MOVE is traced.
#[test]
fn a_trident_unit_line_with_a_comment_is_traced() {
    let path = trace_trident_walker("unit 900;the walker\nMOVE SE\n")
        .path
        .expect("a traced path");
    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(2, 2));
}

/// The control for the case above: the fixture traces under Trident at all.
#[test]
fn a_trident_unit_line_without_a_comment_is_traced() {
    let path = trace_trident_walker("unit 900\nMOVE SE\n")
        .path
        .expect("a traced path");
    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(2, 2));
}
