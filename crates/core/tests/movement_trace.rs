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
const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
const G3_F42_T40: &str = atlantis_hud_fixtures::G3_F42_T40.text;
const G5_F21_T24: &str = atlantis_hud_fixtures::G5_F21_T24.text;
const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

mod common;
use common::at;

/// Traces one unit's orders over the current report alone.
///
/// The core takes the whole orders document rather than one unit's block (ah-048), because a unit
/// standing aboard a ship writes no order of its own - so these blocks are given the `unit` line
/// the editor's document always carries.
fn trace(unit_id: &str, orders: &str) -> MoveOrderTraceResponse {
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
fn document(unit_id: &str, orders: &str) -> String {
    format!("unit {unit_id}\n{orders}")
}

/// Traces one unit's orders over a document given whole, for a unit whose orders are not under a
/// `unit` line of its own: a `FORM`ed unit's sit inside the block of the unit that formed it.
fn trace_document(unit_id: &str, document: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        TURN_71,
        "[]",
        unit_id,
        document,
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

/// "+ Ship [329] : Longship; Load: 110/150; Sailors: 4/4; MaxSpeed: 4." docked in the forest at
/// (49,3); "South : ocean (49,5) in Fu'ihogh Sea." A written SAIL order traces over water exactly
/// like a MOVE traces over land.
#[test]
fn a_written_sail_order_traces_over_water() {
    let response = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        G3_F42_T40,
        "[]",
        "11125",
        &document("11125", "SAIL S"),
    )
    .expect("the ruleset loads");
    let path = response.path.expect("a traced path");

    assert_eq!(path.from, at(49, 3));
    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(49, 5));
    assert_eq!(path.steps[0].terrain, "ocean");
    assert_eq!(path.steps[0].cost, 1, "a fleet's flat cost");
    assert_eq!(path.blocked_from, None, "water never blocks a fleet");
    assert_eq!(
        path.mode,
        Some(atlantis_hud_core::movement::rules::MovementMode::Sail)
    );
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
    // Closed with END, which is what closes a FORM. The rules have no ENDFORM at all - the
    // vocabulary in `orders::grammar` leaves it out on purpose, and the validator calls it an
    // unknown command - so a document written with one is not a document this has to read.
    let path = trace("18642", "MOVE N\nFORM 2\nMOVE SE\nEND\n")
        .path
        .expect("a traced path");
    assert_eq!(
        path.steps[0].to,
        at(7, 51),
        "the formed unit's MOVE SE is not this unit's path"
    );
}

/// The formed unit's own MOVE is traced for the formed unit, from the hex it was formed in
/// (`ah-4hux`). Its sibling above pins that the *parent* does not follow it.
#[test]
fn a_formed_units_own_move_is_traced_for_the_formed_unit() {
    let document = "unit 18642\nFORM 2\nMOVE N\nEND\nGIVE NEW 2 1 LEAD\n";
    let path = trace_document("new-2", document)
        .path
        .expect("the formed unit's own MOVE is traced for it");

    // `rules/form` creates the unit "in the same region as the unit which formed it".
    assert_eq!(path.from, at(7, 53));
    assert_eq!(path.steps[0].to, at(7, 51));

    // An alias no FORM in this document creates names nothing, exactly like a unit number the
    // report does not carry.
    assert_eq!(trace_document("new-9", document).path, None);
}

/// A FORM whose alias cannot be read still owns its block's orders - it just owns them as nobody.
///
/// `Working::open_form` pushes `None` for a FORM with no argument, `FORM 0`, or an alias already
/// taken, and applies the block's orders to no unit at all. The trace has to agree, or the parent
/// draws a line for a MOVE it did not write - which a player typing `FORM` reaches before they have
/// typed the alias (`ah-4hux`).
#[test]
fn a_move_inside_an_unreadable_form_block_belongs_to_nobody() {
    assert_eq!(
        trace_document("18642", "unit 18642\nFORM\nMOVE N\nEND\n").path,
        None
    );
    assert_eq!(
        trace_document("18642", "unit 18642\nFORM 0\nMOVE N\nEND\n").path,
        None
    );
}

/// A FORM block that has been closed gives the unit its own orders back (#95).
///
/// The reader used to close a block on `ENDTURN` and `ENDFORM` and never on plain `END`, so a
/// correctly written `FORM … END` left the depth counter stuck at one and every later line - the
/// unit's real movement among them - was read as though it still belonged to the formed unit. The
/// order was written, the server would run it, and the map drew nothing.
#[test]
fn a_move_after_a_closed_form_block_is_this_units_own() {
    let path = trace("18642", "FORM 2\nBUY 5 Plainsmen\nEND\nMOVE N\n")
        .path
        .expect("the MOVE after the block is this unit's");

    assert_eq!(path.from, at(7, 53));
    assert_eq!(path.steps[0].to, at(7, 51));
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
        &document("18642", "MOVE N"),
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
        &document("18642", "MOVE N"),
    )
    .expect_err("should refuse");
    assert!(error.contains("remembered regions"), "message was: {error}");
}

/// Tracing runs on every keystroke in the orders editor, so it must ride the same parse the rest
/// of the interface already paid for.
#[test]
fn a_second_trace_over_the_same_turn_parses_nothing() {
    let mut cache = ReportCache::new();

    trace_orders_for_remembered_report(
        &mut cache,
        RULESET,
        TURN_71,
        "[]",
        "18642",
        &document("18642", "MOVE N"),
    )
    .expect("the ruleset loads");
    trace_orders_for_remembered_report(
        &mut cache,
        RULESET,
        TURN_71,
        "[]",
        "18642",
        &document("18642", "MOVE N N"),
    )
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
    assert!(
        path["blockedFrom"].is_null(),
        "camelCase, and nothing on this path blocks"
    );

    let none = serde_json::to_value(trace("18642", "work")).expect("serializes");
    assert!(none["path"].is_null());
}

/// A walker ordered to sea gets its whole path drawn, with the doubt starting at the water: the
/// map dots everything from the blocked step onward, whatever month it falls in.
#[test]
fn an_order_into_the_sea_says_where_the_doubt_starts() {
    // "  Northeast : ocean (8,52) in Atlantis Ocean." - not walkable for Seven of Eight.
    let path = trace("18642", "MOVE NE N").path.expect("a traced path");

    assert_eq!(path.blocked_from, Some(0), "the very first step is the sea");
    assert_eq!(path.steps.len(), 2, "the path is still drawn to its end");
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

/// A unit that boards a fleet this month sails with it: ENTER runs before anything moves, so the
/// tracer must read where the unit stands *after* its own orders rather than where the report
/// found it (ah-ssd). Drones (1297) stands ashore in the plain at (36,44); Raft [235] there is
/// sailed by Drones (10575), and "Southeast : ocean (37,45)".
#[test]
fn a_unit_that_boards_a_fleet_this_month_is_traced_as_sailing_with_it() {
    let orders = "unit 10575\nSAIL SE\nunit 1297\nENTER 235\n";
    let response = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        G5_F21_T24,
        "[]",
        "1297",
        orders,
    )
    .expect("the ruleset loads");
    let path = response.path.expect("the boarding unit is carried");

    assert_eq!(path.from, at(36, 44));
    assert_eq!(path.steps[0].to, at(37, 45));
    assert_eq!(
        path.mode,
        Some(atlantis_hud_core::movement::rules::MovementMode::Sail),
        "it is aboard the raft once its own ENTER has run"
    );

    // Without the ENTER it stands ashore, and the same hull carries it nowhere.
    let ashore = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        G5_F21_T24,
        "[]",
        "1297",
        "unit 10575\nSAIL SE\n",
    )
    .expect("the ruleset loads");
    assert_eq!(ashore.path, None, "a unit ashore follows nobody");
}
