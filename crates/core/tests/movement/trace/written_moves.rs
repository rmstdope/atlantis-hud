use super::support::{document, trace};
use crate::common::at;
use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
const G3_F42_T40: &str = atlantis_hud_fixtures::G3_F42_T40.text;
const G5_F21_T24: &str = atlantis_hud_fixtures::G5_F21_T24.text;
const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

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

/// The same synthetic report as `plan/flying_fleet.rs`'s tests, differing only in the
/// hull and the crew it states. Every hex is described in full, so `is_coastal` has each hex's own
/// exits to read.
fn report_with(hull: &str, sailors: &str) -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str(&format!(
        "+ Ship [329] : {hull}; Load: 0/100; Sailors: {sailors}; MaxSpeed: 4.\n"
    ));
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
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : plain (3,3) in Inland.\n\n",
    );
    text.push_str("plain (3,3) in Inland, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n");
    text
}

/// Traces `SAIL SE SE` for the sailor aboard the hull named.
fn trace_flight(hull: &str, sailors: &str) -> atlantis_hud_core::movement::trace::TracedPath {
    let response = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        &report_with(hull, sailors),
        "[]",
        "900",
        &document("900", "SAIL SE SE"),
    )
    .expect("the ruleset loads");
    response.path.expect("a traced path")
}

/// `data/BALL`: "This is a flying 'ship' ...". Land refuses it nothing, so the written order is
/// drawn solid all the way to the inland plain - the same answer Problems gives about it.
#[test]
fn a_balloons_written_sail_over_land_is_left_undotted() {
    let path = trace_flight("Balloon", "3/3");

    assert_eq!(path.steps.len(), 2);
    assert_eq!(path.steps[1].to, at(3, 3));
    assert_eq!(
        path.mode,
        Some(atlantis_hud_core::movement::rules::MovementMode::Sail)
    );
    assert_eq!(path.blocked_from, None, "land never blocks a flying hull");
}

/// The guard beside it: a hull bound by the water is still dotted from the step into the inland
/// plain, exactly as before this bead.
#[test]
fn a_longships_written_sail_over_land_is_still_dotted() {
    let path = trace_flight("Longship", "4/4");

    assert_eq!(path.steps.len(), 2);
    assert_eq!(
        path.blocked_from,
        Some(1),
        "the step into the inland plain is the one the game refuses"
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
    assert!(
        path["wall"].is_null(),
        "present, and null when nothing walls the route"
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

/// A fleet takes its course from its **owner** - the first unit listed under it
/// (`rules/world_structures`) - and "the owner of a fleet must issue the SAIL order"
/// (`rules/movement_sailing`). Raft [235] lists Drones (10575) first, so a `SAIL` written by
/// Drones (10594) lends a pair of hands and sets no course: the map draws nothing at all, for the
/// writer and for every passenger alike (`ah-ofra`).
#[test]
fn a_course_from_the_wrong_unit_draws_no_route() {
    for unit_id in ["10575", "10594"] {
        let response = trace_orders_for_remembered_report(
            &mut ReportCache::new(),
            RULESET,
            G5_F21_T24,
            "[]",
            unit_id,
            "unit 10594\nSAIL SE\n",
        )
        .expect("the ruleset loads");
        assert_eq!(
            response.path, None,
            "{unit_id} has no course to draw: 10575 owns the raft and ordered nothing"
        );
    }
}

/// `rules/move`: "Multiple MOVE orders given by one unit will chain together."
#[test]
fn two_move_lines_are_traced_as_one_route() {
    let path = trace("18642", "MOVE N\nMOVE N\n")
        .path
        .expect("a traced path");
    assert_eq!(path.steps.len(), 2);
    assert_eq!(path.steps[0].to, at(7, 51));
}
