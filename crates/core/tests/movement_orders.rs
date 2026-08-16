//! Acceptance tests for reading and writing MOVE orders.
//!
//! The planner has to work in both directions: turn a route it found into an order, and read an
//! order the player wrote by hand so the same cost and risk checks can be run against it.

use atlantis_hud_core::movement::graph::{Direction, MapKnowledge};
use atlantis_hud_core::movement::orders::{
    follow_move, is_movement_command, parse_move, render_move, render_sail, MoveStep,
    MOVEMENT_ORDER_COMMANDS,
};
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;

mod common;
use common::at;

fn turn_71() -> ParsedReport {
    parse_report_full(TURN_71)
}

/// `parse_move` reads exactly the words `MOVEMENT_ORDER_COMMANDS` lists - one list, so a shell
/// reader built from the same list can never disagree with the reader that already exists here.
#[test]
fn every_movement_command_is_read_by_parse_move() {
    for word in MOVEMENT_ORDER_COMMANDS {
        assert_eq!(
            parse_move(&format!("{word} N")),
            Some(vec![MoveStep::Go(Direction::North)]),
            "{word} N should read as a move north"
        );
        let lower = word.to_lowercase();
        assert_eq!(
            parse_move(&format!("{lower} N")),
            Some(vec![MoveStep::Go(Direction::North)]),
            "{lower} N should read as a move north, any case"
        );
    }

    assert!(
        is_movement_command("Advance"),
        "any case is a movement command"
    );
    assert!(!is_movement_command("STUDY"), "a non-movement word is not");
    assert!(
        !is_movement_command("@move"),
        "a bare command token carries no @"
    );
}

/// The turn 71 orders template carries exactly one real MOVE: "MOVE SE SE", for unit 15571.
#[test]
fn reads_the_move_order_the_report_actually_contains() {
    let steps = parse_move("MOVE SE SE").expect("a MOVE order");

    assert_eq!(
        steps,
        vec![
            MoveStep::Go(Direction::Southeast),
            MoveStep::Go(Direction::Southeast)
        ]
    );
}

#[test]
fn reads_the_long_and_short_forms_and_ignores_case() {
    assert_eq!(
        parse_move("move n ne").expect("a MOVE order"),
        vec![
            MoveStep::Go(Direction::North),
            MoveStep::Go(Direction::Northeast)
        ]
    );
    assert_eq!(
        parse_move("MOVE North Southwest").expect("a MOVE order"),
        vec![
            MoveStep::Go(Direction::North),
            MoveStep::Go(Direction::Southwest)
        ]
    );
}

/// A leading `@` marks an order the game repeats every turn. It does not change which order it is.
#[test]
fn a_repeating_move_is_still_a_move() {
    assert_eq!(
        parse_move("@MOVE SE").expect("a MOVE order"),
        vec![MoveStep::Go(Direction::Southeast)]
    );
}

/// "Units may also enter or exit structures while moving. Moving into or out of a structure does
/// not use any movement points at all." They are part of the order and are read, but they are not
/// steps across the map, so the planner keeps them distinct rather than mistaking one for a hex.
#[test]
fn entering_and_leaving_a_structure_are_read_but_not_confused_with_a_hex() {
    assert_eq!(
        parse_move("MOVE OUT N IN").expect("a MOVE order"),
        vec![
            MoveStep::Out,
            MoveStep::Go(Direction::North),
            MoveStep::In(None)
        ]
    );
    // A numbered structure is entered by id.
    assert_eq!(
        parse_move("MOVE IN 4").expect("a MOVE order"),
        vec![MoveStep::In(Some("4".to_string()))]
    );
}

#[test]
fn anything_that_is_not_a_move_order_is_not_one() {
    for line in [
        "",
        "; a comment",
        "TAX",
        "unit 15571",
        "MOVEMENT N",
        "STUDY COMB",
    ] {
        assert_eq!(parse_move(line), None, "{line} should not read as a MOVE");
    }
}

/// ADVANCE is MOVE that attacks anything barring the way. Same route, so the same reading.
#[test]
fn advance_is_read_as_the_move_it_is() {
    assert_eq!(
        parse_move("ADVANCE N").expect("an ADVANCE order"),
        vec![MoveStep::Go(Direction::North)]
    );
}

/// SAIL is a fleet's word for the same steps a MOVE order reads. "the owner of a fleet must issue
/// the SAIL order, and other units wishing to help sail the fleet must also issue the SAIL order."
#[test]
fn sail_is_read_as_the_move_it_is() {
    assert_eq!(
        parse_move("SAIL N NE").expect("a SAIL order"),
        vec![
            MoveStep::Go(Direction::North),
            MoveStep::Go(Direction::Northeast)
        ]
    );
}

#[test]
fn writes_a_sail_order_the_game_would_accept() {
    let steps = vec![
        MoveStep::Go(Direction::North),
        MoveStep::Go(Direction::Northeast),
    ];

    assert_eq!(render_sail(&steps), "SAIL N NE");
}

/// A direction the game has no such thing as makes the whole order unreadable rather than a
/// shorter route: silently dropping it would plan a journey to somewhere the player never asked
/// for.
#[test]
fn an_unreadable_direction_makes_the_whole_order_unreadable() {
    assert_eq!(parse_move("MOVE N SIDEWAYS"), None);
    assert_eq!(
        parse_move("MOVE"),
        None,
        "a MOVE with no directions goes nowhere"
    );
}

#[test]
fn writes_a_route_as_an_order_the_game_would_accept() {
    let steps = vec![
        MoveStep::Go(Direction::Southeast),
        MoveStep::Go(Direction::Southeast),
    ];

    assert_eq!(render_move(&steps), "MOVE SE SE");
}

#[test]
fn what_is_written_reads_back_as_what_it_was() {
    let steps = vec![
        MoveStep::Go(Direction::North),
        MoveStep::In(Some("4".to_string())),
        MoveStep::Out,
        MoveStep::Go(Direction::Southwest),
    ];

    assert_eq!(
        parse_move(&render_move(&steps)).expect("what we write, we can read"),
        steps
    );
}

/// Following an order across the map is what lets a hand-written MOVE be costed and checked.
#[test]
fn follows_an_order_across_the_map() {
    let report = turn_71();
    let map = MapKnowledge::from_report(&report);

    // "* Drones (15571)" stands in the ocean at (18,44); its order is "MOVE SE SE".
    // "  Southeast : ocean (19,45)" - and (19,45) was never visited, so nothing describes its exits.
    let followed = follow_move(
        &map,
        at(18, 44),
        &parse_move("MOVE SE SE").expect("an order"),
    );

    assert_eq!(followed.hexes, vec![at(19, 45)]);
    assert!(
        followed.left_the_map,
        "the second step leaves everything the faction knows"
    );
}

#[test]
fn following_an_order_that_stays_on_known_ground_reaches_the_end() {
    let report = turn_71();
    let map = MapKnowledge::from_report(&report);

    // From the mountain at (7,53), one step north to the mountain at (7,51).
    let followed = follow_move(&map, at(7, 53), &parse_move("MOVE N").expect("an order"));

    assert_eq!(followed.hexes, vec![at(7, 51)]);
    assert!(!followed.left_the_map);
}

/// Entering and leaving structures move a unit within its hex, so they cost nothing and change no
/// coordinate.
#[test]
fn entering_a_structure_does_not_move_the_unit_anywhere() {
    let report = turn_71();
    let map = MapKnowledge::from_report(&report);

    let followed = follow_move(&map, at(7, 53), &parse_move("MOVE IN").expect("an order"));

    assert!(followed.hexes.is_empty());
    assert!(!followed.left_the_map);
}
