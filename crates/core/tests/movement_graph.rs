//! Acceptance tests for the map a route is planned over, and for how a unit gets about.
//!
//! Both are read out of the committed turn 71 report by hand, so a failure here is a disagreement
//! with the report rather than with an earlier run.

use atlantis_hud_core::movement::graph::{Direction, MapKnowledge};
use atlantis_hud_core::movement::mode::{can_swim, mobility, Mobility};
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::parse_report_full;

const TURN_71: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");

fn at(x: i32, y: i32) -> Coordinate {
    Coordinate { x, y, z: 1 }
}

fn knowledge() -> MapKnowledge {
    MapKnowledge::from_report(&parse_report_full(TURN_71))
}

// ---------------------------------------------------------------- the map

/// A report describes far more of the map than the faction stood in: every region block names its
/// six neighbours with their terrain, which is enough to cost a step into one.
#[test]
fn the_map_holds_both_visited_hexes_and_the_ones_their_exits_name() {
    let map = knowledge();

    assert_eq!(map.visited_count(), 11, "regions the faction had units in");
    assert_eq!(
        map.len(),
        57,
        "eleven visited plus every distinct hex their exits name"
    );
}

#[test]
fn a_visited_hex_carries_what_the_report_says_about_it() {
    let map = knowledge();

    // "mountain (7,53) in Inhead, contains Inholm [city], 12051 peasants..."
    let hex = map.hex(at(7, 53)).expect("the faction stood there");
    assert_eq!(hex.terrain, "mountain");
    assert_eq!(hex.province, "Inhead");
    assert!(hex.visited);
}

/// The third map state: known by name from a neighbour's exits, never visited. Terrain is known,
/// so a step into it can be costed; nothing else about it is.
#[test]
fn a_hex_named_only_by_an_exit_is_known_but_not_visited() {
    let map = knowledge();

    // "  Southwest : jungle (9,51) in Maput." from the swamp at (10,50).
    let hex = map.hex(at(9, 51)).expect("an exit named it");
    assert_eq!(hex.terrain, "jungle");
    assert_eq!(hex.province, "Maput");
    assert!(
        !hex.visited,
        "naming a hex is not the same as standing in it"
    );
}

#[test]
fn an_unheard_of_hex_is_absent_rather_than_guessed_at() {
    let map = knowledge();

    assert!(map.hex(at(99, 99)).is_none());
}

/// Adjacency comes from the coordinates the report states, not from arithmetic on our own. Atlantis
/// maps wrap east to west and the rules page never says where the seam is, so computing a
/// neighbour would be a guess exactly at the edge; the report simply names it.
#[test]
fn neighbours_are_the_ones_the_report_names() {
    let map = knowledge();

    let mut neighbours: Vec<(Direction, Coordinate)> = map.neighbours(at(10, 50)).collect();
    neighbours.sort_by_key(|(direction, _)| *direction as u8);

    assert_eq!(
        neighbours,
        vec![
            (Direction::North, at(10, 48)),
            (Direction::Northeast, at(11, 49)),
            (Direction::Southeast, at(11, 51)),
            (Direction::South, at(10, 52)),
            (Direction::Southwest, at(9, 51)),
            (Direction::Northwest, at(9, 49)),
        ]
    );
}

#[test]
fn a_hex_we_only_know_by_name_has_no_neighbours_of_its_own() {
    let map = knowledge();

    // Its terrain is known, but nothing named *its* exits, so the graph stops there.
    assert_eq!(map.neighbours(at(9, 51)).count(), 0);
}

#[test]
fn roads_are_read_off_the_structures_that_are_roads() {
    let map = knowledge();

    // "+ Mountain Road [4] : Road N.", "Road NW" and "Road SW", in the mountain at (7,53).
    let hex = map.hex(at(7, 53)).expect("visited");
    let mut roads = hex.roads.clone();
    roads.sort_by_key(|direction| *direction as u8);

    assert_eq!(
        roads,
        vec![Direction::North, Direction::Southwest, Direction::Northwest]
    );

    // A hex with no road structures has no roads, rather than an empty guess at some.
    assert!(map
        .hex(at(10, 50))
        .expect("visited")
        .roads
        .contains(&Direction::Southwest));
    assert_eq!(map.hex(at(19, 39)).expect("visited").roads, Vec::new());
}

/// A road only helps when both hexes carry one facing the other, and a report only lists structures
/// for hexes the faction stood in - so the far side is usually unknowable. No two visited regions
/// in this report are adjacent, so the fixture cannot show a connected pair at all; this is the
/// synthetic case that can.
#[test]
fn a_road_connects_only_when_both_sides_have_one_facing_the_other() {
    let report = parse_report_full(
        "Foo (1) Report\n\
         \n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\
         \n\
         Exits:\n  \
         South : plain (1,3) in Nowhere.\n\
         \n\
         + Northbound [1] : Road S.\n\
         \n\
         plain (1,3) in Nowhere, 10 peasants (orcs), $5.\n\
         \n\
         Exits:\n  \
         North : plain (1,1) in Nowhere.\n\
         \n\
         + Southbound [2] : Road N.\n",
    );
    let map = MapKnowledge::from_report(&report);

    assert!(
        map.road_connects(at(1, 1), Direction::South),
        "both sides carry a road facing the other"
    );
    assert!(
        map.road_connects(at(1, 3), Direction::North),
        "the same road, read from the other end"
    );
}

#[test]
fn a_road_with_nothing_on_the_far_side_does_not_connect() {
    let map = knowledge();

    // The mountain at (7,53) has a road north, but (7,51) was never visited, so whether it has one
    // facing back is simply unknown - and unknown is not a bonus.
    assert!(!map.road_connects(at(7, 53), Direction::North));
}

// ---------------------------------------------------------------- the unit

/// The report states each unit's four capacities as the server computed them, so how a unit travels
/// is read rather than derived. The order is fly/ride/walk/swim, confirmed against three units.
#[test]
fn a_unit_takes_the_fastest_mode_its_weight_allows() {
    let report = parse_report_full(TURN_71);
    let unit_by = |id: &str| {
        report
            .units()
            .find(|unit| unit.unit_id == id)
            .expect("the report should carry that unit")
            .clone()
    };

    // "Six of Seven (881) ... Weight: 773. Capacity: 901/901/916/0."
    assert_eq!(
        mobility(&unit_by("881")),
        Mobility::Moves(MovementMode::Fly),
        "flight is available and fastest"
    );

    // "Drone (13432) ... hill dwarf, horse. Weight: 60. Capacity: 0/70/85/0."
    assert_eq!(
        mobility(&unit_by("13432")),
        Mobility::Moves(MovementMode::Ride),
        "the horse can carry the unit"
    );

    // "Drones (14451) ... 50 lizardmen, 7500 silver. Weight: 500. Capacity: 0/0/750/750."
    assert_eq!(
        mobility(&unit_by("14451")),
        Mobility::Moves(MovementMode::Walk)
    );
}

/// The fixture's own example of a unit that cannot move at all: its weight exceeds every one of its
/// capacities, so the game will not let it issue a MOVE order.
#[test]
fn a_unit_heavier_than_all_its_capacities_cannot_move() {
    let report = parse_report_full(TURN_71);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == "13972")
        .expect("the report should carry that unit");

    // "Thirteen of Eight (13972) ... Weight: 17. Capacity: 0/0/15/0."
    assert_eq!(mobility(unit), Mobility::Overloaded);
}

/// A report prints weight and capacity only for your own units, so a foreign unit's mobility is not
/// unknown by accident - it is genuinely not in the report, and saying so beats assuming it walks.
#[test]
fn a_foreign_unit_has_no_stated_mobility() {
    let report = parse_report_full(TURN_71);
    let foreign = report
        .units()
        .find(|unit| !unit.own && unit.weight.is_none())
        .expect("the report is full of foreign units");

    assert_eq!(mobility(foreign), Mobility::Unstated);
}

/// Swimming is a separate question from speed: it decides whether a coastline stops the unit, not
/// how fast it goes. This ruleset's water rule exempts only flight from needing a ship, so a
/// swimmer is not thereby allowed across ocean - but the capacity is read and kept regardless.
#[test]
fn swimming_is_read_from_the_swim_capacity_alone() {
    let report = parse_report_full(TURN_71);
    let unit_by = |id: &str| {
        report
            .units()
            .find(|unit| unit.unit_id == id)
            .expect("the report should carry that unit")
    };

    // "Drones (14451) ... 50 lizardmen. Weight: 500. Capacity: 0/0/750/750." - lizardmen swim.
    assert!(can_swim(unit_by("14451")));

    // "Drone (13432) ... hill dwarf, horse. Weight: 60. Capacity: 0/70/85/0." - it rides, and sinks.
    assert!(!can_swim(unit_by("13432")));

    // A unit whose mobility the report never stated cannot be assumed to swim either.
    let foreign = report
        .units()
        .find(|unit| !unit.own && unit.weight.is_none())
        .expect("the report is full of foreign units");
    assert!(!can_swim(foreign));
}

/// A map remembered across turns is what makes a route longer than one step possible.
///
/// A single report describes eleven hexes and names fifty-four more, but the named ones carry no
/// exits of their own, so the graph stops dead at the fringe. Regions remembered from earlier turns
/// bring their exits with them, and the pieces join up.
#[test]
fn remembered_regions_join_the_map_up_where_one_report_cannot() {
    use atlantis_hud_core::movement::graph::RememberedRegion;

    // Two turns of the same corridor, each describing one end of it.
    let older = parse_report_full(
        "Foo (1) Report\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n",
    );
    let newer = parse_report_full(
        "Foo (1) Report\n\n\
         plain (2,2) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Northwest : plain (1,1) in Nowhere.\n  Southeast : plain (3,3) in Nowhere.\n",
    );

    // From the newer report alone, (1,1) is a name with no exits: nothing leads back out of it.
    let alone = MapKnowledge::from_report(&newer);
    assert_eq!(alone.neighbours(at(1, 1)).count(), 0);

    let remembered = MapKnowledge::from_remembered(
        &newer,
        &[RememberedRegion {
            region: older.regions[0].clone(),
            last_seen_turn: 40,
        }],
    );

    // Now (1,1) is a hex the faction stood in, with the exit it had at the time.
    let hex = remembered.hex(at(1, 1)).expect("remembered");
    assert!(hex.visited);
    assert_eq!(hex.last_seen_turn, Some(40));
    assert_eq!(
        remembered.neighbours(at(1, 1)).collect::<Vec<_>>(),
        vec![(Direction::Southeast, at(2, 2))]
    );

    // And the graph now spans both ends rather than stopping at the fringe.
    assert_eq!(remembered.visited_count(), 2);
}

/// The current report wins wherever the two disagree. A hex described this turn is worth more than
/// the same hex remembered from turn forty, and only the current description can be trusted about
/// who is standing in it.
#[test]
fn the_current_report_overrides_what_was_remembered() {
    use atlantis_hud_core::movement::graph::RememberedRegion;

    let remembered_region = parse_report_full(
        "Foo (1) Report\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n\n\
         - Someone (500), Bar (2), 3 orcs [ORC].\n",
    )
    .regions[0]
        .clone();

    // The same hex, now a mountain and empty of strangers.
    let current = parse_report_full(
        "Foo (1) Report\n\n\
         mountain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n",
    );

    let map = MapKnowledge::from_remembered(
        &current,
        &[RememberedRegion {
            region: remembered_region,
            last_seen_turn: 40,
        }],
    );

    let hex = map.hex(at(1, 1)).expect("known");
    assert_eq!(hex.terrain, "mountain", "this turn's description wins");
    assert!(
        hex.units.is_empty(),
        "a remembered garrison is not evidence of a present one"
    );
}

/// A hex remembered twice keeps the more recent description.
#[test]
fn the_newer_of_two_memories_wins() {
    use atlantis_hud_core::movement::graph::RememberedRegion;

    let make = |terrain: &str| {
        parse_report_full(&format!(
            "Foo (1) Report\n\n\
             {terrain} (5,5) in Nowhere, 10 peasants (orcs), $5.\n\n\
             Exits:\n  North : plain (5,3) in Nowhere.\n"
        ))
        .regions[0]
            .clone()
    };

    let empty = parse_report_full("Foo (1) Report\n");
    let map = MapKnowledge::from_remembered(
        &empty,
        &[
            RememberedRegion {
                region: make("swamp"),
                last_seen_turn: 60,
            },
            RememberedRegion {
                region: make("forest"),
                last_seen_turn: 20,
            },
        ],
    );

    let hex = map.hex(at(5, 5)).expect("remembered");
    assert_eq!(hex.terrain, "swamp");
    assert_eq!(hex.last_seen_turn, Some(60));
}
