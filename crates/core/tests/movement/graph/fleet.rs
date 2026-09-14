use crate::common::at;
use atlantis_hud_core::movement::graph::{may_leave_land, Direction, MapKnowledge};
use atlantis_hud_core::report::parse_report_full;

/// `rules/movement_sailing`: "Ships may not sail through single hex land masses and must leave via
/// the same side they entered or a side adjacent to that one." Entering travelling `entered` means
/// coming in through the side facing back the way it came, so the three sides refused are the
/// direction of travel itself and the two beside it - and only one of those three is `opposite`.
#[test]
fn three_of_the_six_sides_are_refused_whichever_way_a_fleet_came_in() {
    for entered in Direction::ALL {
        let refused: Vec<Direction> = Direction::ALL
            .into_iter()
            .filter(|leaving| !may_leave_land(entered, *leaving))
            .collect();
        let allowed: Vec<Direction> = Direction::ALL
            .into_iter()
            .filter(|leaving| may_leave_land(entered, *leaving))
            .collect();

        assert_eq!(refused.len(), 3, "entering {entered:?}");
        assert_eq!(allowed.len(), 3, "entering {entered:?}");

        let mut expected_refused = vec![entered];
        expected_refused.extend(entered.beside());
        expected_refused.sort();
        let mut got = refused.clone();
        got.sort();
        assert_eq!(got, expected_refused, "entering {entered:?}");

        let mut expected_allowed = vec![entered.opposite()];
        expected_allowed.extend(entered.opposite().beside());
        expected_allowed.sort();
        let mut got_allowed = allowed.clone();
        got_allowed.sort();
        assert_eq!(got_allowed, expected_allowed, "entering {entered:?}");
    }
}

/// The case every agreed sentence is written against: a fleet sailing SE into a plain entered
/// through the plain's NW side, so it may leave NW, N or SW and not SE, NE or S.
#[test]
fn the_refused_sides_after_sailing_southeast_are_the_mockups_three() {
    for leaving in [Direction::Southeast, Direction::Northeast, Direction::South] {
        assert!(
            !may_leave_land(Direction::Southeast, leaving),
            "{leaving:?} should be refused"
        );
    }
    for leaving in [Direction::Northwest, Direction::North, Direction::Southwest] {
        assert!(
            may_leave_land(Direction::Southeast, leaving),
            "{leaving:?} should be allowed"
        );
    }
}

/// An ocean hex is known only by the shore that named it, so it states no exits of its own -
/// and that shore is the only evidence there is that the water has a coast. `adjacent` reads the
/// statement from both ends; `neighbours` reads only the hex's own, and for an ocean hex that is
/// nothing at all.
#[test]
fn an_ocean_hex_named_from_the_shore_knows_its_shore() {
    let report = parse_report_full(
        "Foo (1) Report\n\
         \n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\
         \n\
         Exits:\n  \
         Southeast : ocean (2,2) in Atlantis Ocean.\n",
    );
    let map = MapKnowledge::from_report(&report);

    assert_eq!(
        map.neighbours(at(2, 2)).count(),
        0,
        "nothing described the ocean's own exits"
    );
    assert_eq!(
        map.adjacent(at(2, 2)),
        vec![(Direction::Northwest, at(1, 1))],
        "the shore that named it is adjacency all the same"
    );

    // The hex's own statement is unchanged, and is not duplicated by the reverse edge.
    assert_eq!(
        map.adjacent(at(1, 1)),
        vec![(Direction::Southeast, at(2, 2))]
    );
}
