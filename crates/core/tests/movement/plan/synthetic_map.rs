use super::support::{corridor, corridor_with, plan, turn_71};
use crate::common::{at, ruleset};
use atlantis_hud_core::movement::graph::{Direction, MapKnowledge};
use atlantis_hud_core::movement::plan::{plan_route, RouteProblem};
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::parse_report_full;

#[test]
fn a_route_of_several_steps_adds_up() {
    let report = corridor(&["plain", "plain", "plain", "plain"]);
    let route = plan(&report, "900", at(4, 4)).expect("a legal route");

    assert_eq!(route.steps.len(), 3);
    assert_eq!(
        route.total_cost, 3,
        "three ordinary steps at one point each"
    );
    assert_eq!(route.order, "MOVE SE SE SE");
}

/// Movement points carry over between months: "these movement points can be carried over from one
/// month to another if a MOVE command did not complete in the month".
///
/// Costs of 1, 2 and 1 total four, and a walker earns two a month, so this is two months. Packing
/// each month separately would waste the odd point and make it three - the difference this test
/// exists to pin.
#[test]
fn unspent_movement_points_carry_into_the_next_month() {
    let report = corridor(&["plain", "plain", "mountain", "plain"]);
    let route = plan(&report, "900", at(4, 4)).expect("a legal route");

    assert_eq!(
        route.steps.iter().map(|step| step.cost).collect::<Vec<_>>(),
        vec![1, 2, 1]
    );
    assert_eq!(route.total_cost, 4);
    assert_eq!(
        route.months.len(),
        2,
        "four points at two a month, with the odd point carried rather than wasted"
    );
}

#[test]
fn a_long_route_is_broken_into_the_months_it_takes() {
    let report = corridor(&["plain", "mountain", "mountain", "mountain"]);
    let route = plan(&report, "900", at(4, 4)).expect("a legal route");

    assert_eq!(route.total_cost, 6);
    assert_eq!(route.months.len(), 3, "six points at two a month");
    assert_eq!(
        route.months.last().expect("a final month").ends_at,
        at(4, 4)
    );
}

/// A road halves the cost, but only where both hexes carry one facing the other.
#[test]
fn a_connected_road_makes_the_step_cheaper() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : mountain (2,2) in Nowhere.\n\n");
    text.push_str("+ Road [1] : Road SE.\n\n");
    text.push_str("* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    text.push_str("mountain (2,2) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : plain (1,1) in Nowhere.\n\n");
    text.push_str("+ Road [2] : Road NW.\n");

    let report = parse_report_full(&text);
    let route = plan(&report, "900", at(2, 2)).expect("a legal step");

    assert_eq!(
        route.total_cost, 1,
        "a mountain costs two, halved to one by the road"
    );
    assert!(route.steps[0].road, "the step should say it used a road");
}

/// A flier crosses water freely: "A unit which can fly is capable of travelling over water".
#[test]
fn a_flier_crosses_water_that_stops_a_walker() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : ocean (2,2) in Sea.\n\n");
    // "Capacity: 901/901/916/0" is the fixture's own flying unit, scaled down.
    text.push_str("* Flier (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 100/0/100/0.\n");
    text.push_str("* Walker (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    text.push_str("ocean (2,2) in Sea.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (1,1) in Nowhere.\n  Southeast : plain (3,3) in Nowhere.\n\n",
    );
    text.push_str("plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : ocean (2,2) in Sea.\n");
    let report = parse_report_full(&text);

    // Four points at four a month: the flier crosses the sea and lands, all in one month.
    let route = plan(&report, "900", at(3, 3)).expect("flight crosses water");
    assert_eq!(route.mode, MovementMode::Fly);
    assert_eq!(route.steps.len(), 2);
    assert_eq!(route.months.len(), 1, "it must not stop over the sea");

    // The walker cannot even set out.
    let problem = plan(&report, "901", at(3, 3)).expect_err("the sea is in the way");
    assert!(matches!(problem, RouteProblem::OceanNeedsShip { .. }));
}

/// "flying units must end their movement on land or else drown", and movement runs out at the end
/// of a month. A crossing wider than one month's flying allowance is refused rather than planned
/// as a drowning.
#[test]
fn a_flight_that_would_run_out_of_month_over_the_sea_is_refused() {
    // A flier has four movement points a month, so five hexes of open sea cannot be crossed in one.
    let sea = 5;
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : ocean (2,2) in Sea.\n\n");
    text.push_str("* Flier (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 100/0/100/0.\n\n");

    for index in 0..sea {
        let (x, y) = (2 + index, 2 + index);
        let behind = if index == 0 {
            ("plain", "Nowhere")
        } else {
            ("ocean", "Sea")
        };
        let ahead = if index == sea - 1 {
            ("plain", "Nowhere")
        } else {
            ("ocean", "Sea")
        };
        text.push_str(&format!("ocean ({x},{y}) in Sea.\n\nExits:\n"));
        text.push_str(&format!(
            "  Northwest : {} ({},{}) in {}.\n",
            behind.0,
            x - 1,
            y - 1,
            behind.1
        ));
        text.push_str(&format!(
            "  Southeast : {} ({},{}) in {}.\n\n",
            ahead.0,
            x + 1,
            y + 1,
            ahead.1
        ));
    }

    let (fx, fy) = (2 + sea, 2 + sea);
    text.push_str(&format!(
        "plain ({fx},{fy}) in Nowhere, 10 peasants (orcs), $5.\n\n"
    ));
    text.push_str(&format!(
        "Exits:\n  Northwest : ocean ({},{}) in Sea.\n",
        fx - 1,
        fy - 1
    ));

    let report = parse_report_full(&text);
    let problem = plan(&report, "900", at(fx, fy)).expect_err("it would drown on the way");

    assert!(
        matches!(problem, RouteProblem::FlightWouldEndOverOcean { .. }),
        "expected a drowning refusal, got {problem:?}"
    );
}

/// Difficult ground is a rule about riding and walking: "take two movement points for riding or
/// walking units to enter". A flier pays the ordinary cost, and charging it the premium would have
/// reported a journey a third longer than the game will.
#[test]
fn difficult_ground_does_not_slow_a_flier() {
    let mountains = ["plain", "mountain", "mountain", "mountain", "mountain"];

    let walking = corridor_with(&mountains, "0/0/15/0");
    let walker = plan(&walking, "900", at(5, 5)).expect("a legal route");
    assert_eq!(walker.mode, MovementMode::Walk);
    assert_eq!(walker.total_cost, 8, "four mountains at two apiece");
    assert_eq!(walker.months.len(), 4, "eight points at two a month");

    let flying = corridor_with(&mountains, "100/0/100/0");
    let flier = plan(&flying, "900", at(5, 5)).expect("a legal route");
    assert_eq!(flier.mode, MovementMode::Fly);
    assert_eq!(flier.total_cost, 4, "a flier is untroubled by mountains");
    assert_eq!(flier.months.len(), 1, "four points cover it in one month");
}

/// Every other multi-step test is a corridor with exactly one possible route, so the search never
/// has to choose. This one does: the direct way is two mountains, the long way round is three
/// plains, and the plains are cheaper.
#[test]
fn the_search_takes_the_cheaper_way_round_rather_than_the_shorter_one() {
    let mut text = String::from("Foo (1) Report\n\n");

    // A diamond: start at (1,1), finish at (3,3). Direct via mountains at (2,2); around via plains
    // at (2,0) and (3,1).
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : mountain (2,2) in Nowhere.\n  Northeast : plain (2,0) in Nowhere.\n\n");
    text.push_str("* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");

    text.push_str("mountain (2,2) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : plain (1,1) in Nowhere.\n  Northeast : mountain (3,1) in Nowhere.\n\n");

    text.push_str("plain (2,0) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Southwest : plain (1,1) in Nowhere.\n  Southeast : plain (3,1) in Nowhere.\n\n",
    );

    text.push_str("plain (3,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,0) in Nowhere.\n  Southwest : mountain (2,2) in Nowhere.\n  South : plain (3,3) in Nowhere.\n\n");

    text.push_str("plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  North : plain (3,1) in Nowhere.\n");

    let report = parse_report_full(&text);
    let route = plan(&report, "900", at(3, 3)).expect("a legal route");

    // Direct: mountain (2) then mountain (2) then plain (1) = 5. Around: 1 + 1 + 1 = 3.
    assert_eq!(route.total_cost, 3, "three plains beat two mountains");
    assert_eq!(
        route.steps.len(),
        3,
        "the longer way in steps is the cheaper one"
    );
    assert!(
        route.steps.iter().all(|step| step.terrain == "plain"),
        "it should not touch the mountains at all"
    );

    // The rebuilt path has to be the one whose cost was found, not a stale predecessor chain.
    assert_eq!(
        route.steps.iter().map(|step| step.cost).sum::<u32>(),
        route.total_cost
    );
    assert_eq!(route.steps.last().expect("a final step").to, at(3, 3));
}

/// "I do not know where your unit is" and "there is no way through" are different answers, and
/// reporting the first as the second hides a broken map behind a plausible-sounding refusal.
///
/// A unit reaches this state when its region is not in the map - which happens once sightings are
/// carried across turns and a unit is read from a turn whose region has since been dropped.
#[test]
fn a_unit_whose_hex_the_map_does_not_know_is_named_as_such() {
    let report = turn_71();
    let map = MapKnowledge::from_report(&parse_report_full(
        "Foo (1) Report\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : plain (2,2) in Nowhere.\n",
    ));

    // The unit is real and mobile, but it stands in a hex this map has never heard of.
    let stranger = report
        .units()
        .find(|unit| unit.unit_id == "18642")
        .expect("the report should carry that unit");

    let problem = plan_route(&map, &ruleset(), stranger, at(2, 2)).expect_err("nowhere to start");
    assert!(
        matches!(problem, RouteProblem::OriginUnknown),
        "expected the origin to be named as the problem, got {problem:?}"
    );
}

/// (3,3) states only its Southeast exit, so its report proves a wall on the North side even though
/// (3,1) beyond it is on no report. The planner used to guess its way straight through.
#[test]
fn the_planner_goes_round_a_wall_facing_unexplored_ground() {
    let report = parse_report_full(concat!(
        "Foo (1) Report\n\n",
        "plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\n",
        "Exits:\n",
        "  Southeast : plain (4,4) in Nowhere.\n\n",
        "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n",
        "plain (4,4) in Nowhere, 10 peasants (orcs), $5.\n\n",
        "Exits:\n",
        "  Northwest : plain (3,3) in Nowhere.\n",
        "  North : plain (4,2) in Nowhere.\n\n",
    ));
    let destination = at(3, 1);
    assert!(MapKnowledge::from_report(&report)
        .hex(destination)
        .is_none());

    let route = plan(&report, "900", destination).expect("a way round");

    assert_ne!(route.steps[0].direction, Direction::North);
}
