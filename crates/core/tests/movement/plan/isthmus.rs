//! `rules/movement_sailing`, in every committed world: "Ships may not sail through single hex land
//! masses and must leave via the same side they entered or a side adjacent to that one." A fleet
//! sailing SE out of `ocean (1,1)` into `plain (2,2)` entered through the plain's NW side, so it may
//! leave NW, N or SW - and SE, NE and S are all refused.

use super::support::{beyond, longship, neck, plan};
use crate::common::at;
use atlantis_hud_core::movement::graph::Direction;
use atlantis_hud_core::movement::plan::RouteProblem;
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::parse_report_full;

/// The straight-through case the whole bead is named for: in through the plain's NW side and out
/// through its SE one, which is the side facing the way the fleet was already travelling.
#[test]
fn a_fleet_is_refused_sailing_straight_through_a_neck_of_land() {
    let report = neck(Direction::Southeast, "");
    let problem = plan(&report, "900", beyond(Direction::Southeast))
        .expect_err("the rule refuses the crossing");

    assert_eq!(
        problem,
        RouteProblem::IsthmusNeedsCanal {
            coordinate: at(2, 2),
            terrain: "plain".to_string(),
        }
    );
}

/// Three of the six sides are refused, not one, and only one of the three is the opposite side.
/// Entering through NW, they are SE, NE and S.
#[test]
fn a_fleet_is_refused_both_of_the_other_two_sides_as_well() {
    for leaving in [Direction::Northeast, Direction::South] {
        let report = neck(leaving, "");
        let problem = plan(&report, "900", beyond(leaving)).expect_err("the rule refuses it");

        assert_eq!(
            problem,
            RouteProblem::IsthmusNeedsCanal {
                coordinate: at(2, 2),
                terrain: "plain".to_string(),
            },
            "leaving {leaving:?}"
        );
    }
}

/// The two sides beside the one it entered by are allowed, as is that side itself.
#[test]
fn a_fleet_may_turn_to_a_side_beside_the_one_it_entered() {
    for leaving in [Direction::North, Direction::Southwest] {
        let report = neck(leaving, "");
        let route = plan(&report, "900", beyond(leaving))
            .unwrap_or_else(|problem| panic!("leaving {leaving:?} should be legal: {problem:?}"));

        assert_eq!(route.mode, MovementMode::Sail, "leaving {leaving:?}");
        assert_eq!(route.steps.len(), 2, "leaving {leaving:?}");
        assert_eq!(route.steps[1].to, beyond(leaving), "leaving {leaving:?}");
    }
}

/// "Ships ending their movement in a land hex may sail out along any side connecting to water." A
/// fleet's origin is where last month left it, so its first step is a departure and never a
/// through-pass.
#[test]
fn a_fleet_may_leave_the_hex_it_started_in_by_any_water_side() {
    // The same corridor with the fleet standing in the plain itself, so there is no entry side.
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : ocean (3,3) in Sea.\n\n",
    );
    text.push_str(&longship());
    text.push_str("ocean (3,3) in Sea.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n");
    let report = parse_report_full(&text);

    let route = plan(&report, "900", at(3, 3)).expect("a departure is not a through-pass");
    assert_eq!(route.steps.len(), 1);
    assert_eq!(route.steps[0].to, at(3, 3));
}

/// Where a way round by water exists the planner simply gives it, with not one word about the
/// shortcut it could not take.
#[test]
fn a_fleet_takes_the_long_way_round_rather_than_through_the_neck() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n  South : ocean (1,3) in Sea.\n\n");
    text.push_str(&longship());
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : ocean (3,3) in Sea.\n\n",
    );
    text.push_str("ocean (1,3) in Sea.\n\n");
    text.push_str("Exits:\n  North : ocean (1,1) in Sea.\n  Southeast : ocean (2,4) in Sea.\n\n");
    text.push_str("ocean (2,4) in Sea.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,3) in Sea.\n  Northeast : ocean (3,3) in Sea.\n\n",
    );
    text.push_str("ocean (3,3) in Sea.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (2,2) in Coast.\n  Southwest : ocean (2,4) in Sea.\n",
    );
    let report = parse_report_full(&text);

    let route = plan(&report, "900", at(3, 3)).expect("the water route is legal");
    assert_eq!(route.steps.len(), 3, "round by water, not through the neck");
    assert_eq!(route.total_cost, 3);
    assert_eq!(route.order, "SAIL S SE NE");
}

/// The rule is the sailing rule's, so a walker crossing the same neck is unaffected.
#[test]
fn a_walker_crossing_the_same_neck_is_unaffected() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str("* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (1,1) in Coast.\n  Southeast : plain (3,3) in Coast.\n\n",
    );
    text.push_str("plain (3,3) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n");
    let report = parse_report_full(&text);

    let route = plan(&report, "900", at(3, 3)).expect("a walker is not a fleet");
    assert_eq!(route.steps.len(), 2);
}

/// A flying hull is bound by none of the sailing rule, this restriction included.
#[test]
fn a_flying_fleet_is_not_bound_by_the_sides() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str(
        "+ Ship [329] : Fleet, 4 Galleons, 1 Balloon; Load: 0/100; Sailors: 4/4; MaxSpeed: 4.\n",
    );
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
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : ocean (3,3) in Sea.\n\n",
    );
    text.push_str("ocean (3,3) in Sea.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n");
    let report = parse_report_full(&text);

    let route = plan(&report, "900", at(3, 3)).expect("a flying hull is unbound");
    assert_eq!(route.steps.len(), 2);
}

/// The restriction is in every world's sailing rules, New Origins' included - which `plan` above
/// uses. This is also the test that catches the rule being wired to a New Age check.
#[test]
fn a_new_origins_fleet_is_refused_the_same_crossing() {
    let report = neck(Direction::Southeast, "");
    // `plan` is hardwired to New Origins, which is exactly the world under test here.
    let problem = plan(&report, "900", at(3, 3)).expect_err("New Origins refuses it too");

    assert_eq!(
        problem,
        RouteProblem::IsthmusNeedsCanal {
            coordinate: at(2, 2),
            terrain: "plain".to_string(),
        }
    );
}
