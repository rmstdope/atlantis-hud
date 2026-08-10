//! Acceptance tests for tracing a unit's written MOVE order.
//!
//! This is the planner's mirror: instead of picking a destination and asking for an order, the
//! player already wrote the order and the map shows where it goes. The real cases come from the
//! committed turn 71 report; anything a single report cannot express - long orders, remembered
//! ground - is driven the same way the planner's acceptance tests drive it.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};
use atlantis_hud_core::report::model::Coordinate;

const TURN_71: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");
const RULESET: &str = include_str!("../../../config/public/ruleset.json");

fn at(x: i32, y: i32) -> Coordinate {
    Coordinate { x, y, z: 1 }
}

/// Traces one unit's orders over the current report alone.
fn trace(unit_id: &str, orders: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        TURN_71,
        "[]",
        unit_id,
        orders,
    )
    .expect("the ruleset loads")
}

/// "* Seven of Eight (18642)" stands in the mountain at (7,53); "  North : mountain (7,51)".
#[test]
fn a_written_move_is_traced_across_the_map() {
    let path = trace("18642", "MOVE N").path.expect("a traced path");

    assert_eq!(path.from, at(7, 53));
    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(7, 51));
    assert_eq!(path.steps[0].terrain, "mountain");
    assert_eq!(path.steps[0].cost, 2);
    assert_eq!(path.months.len(), 1, "two points buy exactly one mountain");
}

#[test]
fn a_unit_with_no_movement_order_has_no_path_to_draw() {
    let answer = trace("18642", "work\nproduce IRON\n");
    assert_eq!(answer.path, None);
}

/// A repeating order is still the same order, and ADVANCE takes the same route as MOVE.
#[test]
fn repeated_and_advancing_orders_read_the_same_as_plain_ones() {
    assert!(trace("18642", "@MOVE N").path.is_some());
    assert!(trace("18642", "ADVANCE N").path.is_some());
}

/// The game executes one movement a month, and a later order replaces an earlier one, so the last
/// readable movement line is the one the map draws.
#[test]
fn the_last_movement_line_in_the_orders_wins() {
    let path = trace("18642", "MOVE SE\nwork\nMOVE N\n")
        .path
        .expect("a traced path");
    assert_eq!(
        path.steps[0].to,
        at(7, 51),
        "the later MOVE N replaced the earlier MOVE SE"
    );
}

/// A TURN block holds orders for the turn after this one, so a MOVE inside it is not what the
/// unit does next - drawing it would answer the headline question wrongly.
#[test]
fn a_move_inside_a_turn_block_is_not_this_turns_move() {
    let path = trace("18642", "MOVE N\nTURN\nMOVE SE\nENDTURN\n")
        .path
        .expect("a traced path");
    assert_eq!(
        path.steps[0].to,
        at(7, 51),
        "the MOVE N outside the block is the one that runs this turn"
    );

    // And a template that only moves next turn draws nothing now.
    let deferred = trace("18642", "work\nTURN\nMOVE SE\nENDTURN\n");
    assert_eq!(deferred.path, None);
}

/// A FORM block's orders belong to the unit being formed, not to the unit that issues them.
#[test]
fn a_move_inside_a_form_block_belongs_to_the_formed_unit() {
    let path = trace("18642", "MOVE N\nFORM 2\nMOVE SE\nENDFORM\n")
        .path
        .expect("a traced path");
    assert_eq!(
        path.steps[0].to,
        at(7, 51),
        "the formed unit's MOVE SE is not this unit's path"
    );
}

/// A movement line that cannot be read at all does not un-write the one that could.
#[test]
fn an_unreadable_movement_line_does_not_hide_a_readable_one() {
    let path = trace("18642", "MOVE N\nMOVE sideways\n")
        .path
        .expect("a traced path");
    assert_eq!(path.steps[0].to, at(7, 51));
}

#[test]
fn a_unit_the_report_does_not_carry_answers_with_no_path() {
    let answer = trace("no-such-unit", "MOVE N");
    assert_eq!(answer.path, None);
}

#[test]
fn an_unusable_ruleset_is_an_error() {
    let error = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        "{}",
        TURN_71,
        "[]",
        "18642",
        "MOVE N",
    )
    .expect_err("should fail");
    assert!(error.contains("ruleset"), "message was: {error}");
}

#[test]
fn memory_that_cannot_be_read_is_refused_rather_than_ignored() {
    let error = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        TURN_71,
        "not json",
        "18642",
        "MOVE N",
    )
    .expect_err("should refuse");
    assert!(error.contains("remembered regions"), "message was: {error}");
}

/// Tracing runs on every keystroke in the orders editor, so it must ride the same parse the rest
/// of the interface already paid for.
#[test]
fn a_second_trace_over_the_same_turn_parses_nothing() {
    let mut cache = ReportCache::new();

    trace_orders_for_remembered_report(&mut cache, RULESET, TURN_71, "[]", "18642", "MOVE N")
        .expect("the ruleset loads");
    trace_orders_for_remembered_report(&mut cache, RULESET, TURN_71, "[]", "18642", "MOVE N N")
        .expect("the ruleset loads");

    assert_ne!(cache.parses(), 0, "the tracer never asked the cache");
    assert_eq!(cache.parses(), 1, "the second trace re-read the report");
}

/// The wire contract TypeScript reads: camelCase throughout, with the path optional.
///
/// Both adapters serialize this type as-is, so the field names asserted here are the ones
/// `core-client` must use. A rename in Rust that never reached TypeScript would otherwise only
/// surface as an undefined read in the browser.
#[test]
fn the_answer_serializes_the_way_typescript_reads_it() {
    let answer = trace("18642", "MOVE N N");
    let json = serde_json::to_value(&answer).expect("serializes");

    let path = &json["path"];
    assert!(path.is_object(), "path should be present here");
    assert_eq!(path["from"]["x"], 7);
    assert_eq!(path["mode"], "walk");
    assert!(path["steps"][0]["terrain"].is_string());
    assert!(path["steps"][0]["road"].is_boolean());
    assert!(
        path["months"][0]["endsAt"].is_object(),
        "camelCase, not ends_at"
    );
    assert!(path["months"][0]["steps"].is_number());

    let none = serde_json::to_value(trace("18642", "work")).expect("serializes");
    assert!(none["path"].is_null());
}

/// An order into country nobody has described is drawn to its end: geometric steps into the fog,
/// costed as though the terrain carried on.
#[test]
fn an_order_into_unexplored_country_is_drawn_to_its_end() {
    // (7,53)'s north neighbour (7,51) is known by name only, so its own exits are unknown and the
    // second step must be extrapolated.
    let path = trace("18642", "MOVE N N").path.expect("a traced path");

    assert_eq!(
        path.steps.iter().map(|step| step.to).collect::<Vec<_>>(),
        vec![at(7, 51), at(7, 49)]
    );
    assert_eq!(
        path.steps[1].terrain, "mountain",
        "guessed from the last hex seen"
    );
}
