use atlantis_hud_core::movement::graph::{Direction, MapKnowledge};
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::parse_report_full;

/// Cavern (9,3,2) in the Arcanum report lists only Southeast, South and Northwest, so its report
/// proves the other three sides have no way through.
#[test]
fn a_cavern_whose_exits_leave_out_three_sides_is_walled_on_those_three() {
    let map = MapKnowledge::from_report(&parse_report_full(
        atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text,
    ));
    let cavern = Coordinate { x: 9, y: 3, z: 2 };

    assert!(map.wall(cavern, Direction::North));
    assert!(map.wall(cavern, Direction::Northeast));
    assert!(map.wall(cavern, Direction::Southwest));
    assert!(!map.wall(cavern, Direction::Southeast));
    assert!(!map.wall(cavern, Direction::South));
    assert!(!map.wall(cavern, Direction::Northwest));
}

/// The surface of the same report lists every exit, so none of its hexes proves a wall.
#[test]
fn no_surface_hex_of_the_arcanum_report_is_walled() {
    let map = MapKnowledge::from_report(&parse_report_full(
        atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text,
    ));
    let walls = map.walls();

    assert!(!walls.is_empty(), "the underground has walls");
    assert!(walls.iter().all(|wall| wall.from.z != 1));
}
