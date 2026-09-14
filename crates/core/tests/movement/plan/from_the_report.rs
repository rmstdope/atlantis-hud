use super::support::{corridor, corridor_with, plan, turn_71};
use crate::common::{at, ruleset};
use atlantis_hud_core::movement::graph::MapKnowledge;
use atlantis_hud_core::movement::plan::{plan_route, RouteProblem};
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::parse_report_full;

/// "* Seven of Eight (18642) ... Weight: 10. Capacity: 0/0/15/0." - a walker, two movement points,
/// standing in the mountain at (7,53) whose north neighbour is another mountain.
#[test]
fn a_walker_steps_into_the_neighbouring_mountain_in_one_month() {
    let report = turn_71();
    let route = plan(&report, "18642", at(7, 51)).expect("a legal step");

    assert_eq!(route.mode, MovementMode::Walk);
    assert_eq!(route.steps.len(), 1);
    assert_eq!(route.steps[0].terrain, "mountain");
    assert_eq!(route.steps[0].cost, 2, "mountain is difficult going");
    assert_eq!(route.total_cost, 2);
    assert_eq!(route.months.len(), 1, "two points buy exactly one mountain");
}

/// "* Drone (1688) ... Weight: 60. Capacity: 0/70/85/0." - a rider, four movement points, in the
/// desert at (15,63).
#[test]
fn ordinary_terrain_costs_less_than_difficult_terrain() {
    let report = turn_71();

    // "  Northeast : desert (16,62) in ..."
    let easy = plan(&report, "1688", at(16, 62)).expect("a legal step");
    assert_eq!(easy.mode, MovementMode::Ride);
    assert_eq!(easy.total_cost, 1);

    // "  Northwest : forest (14,62) in ..."
    let harder = plan(&report, "1688", at(14, 62)).expect("a legal step");
    assert_eq!(harder.total_cost, 2);

    // Four points cover either in a single month.
    assert_eq!(easy.months.len(), 1);
    assert_eq!(harder.months.len(), 1);
}

/// Water is the hard boundary for a land route: "Units may not move through ocean regions without
/// using the SAIL order unless they are capable of flight."
#[test]
fn a_walker_is_refused_the_sea() {
    let report = turn_71();

    // "  Northeast : ocean (8,52) in Atlantis Ocean."
    let problem = plan(&report, "18642", at(8, 52)).expect_err("the sea is not walkable");

    assert!(matches!(
        problem,
        RouteProblem::DestinationNeedsShip { coordinate, ref terrain }
            if coordinate == at(8, 52) && terrain == "ocean"
    ));
}

/// A unit aboard a fleet stands in an ocean hex. It cannot walk out of one any more than into one,
/// and saying so beats planning a march that begins by drowning.
#[test]
fn a_unit_standing_at_sea_cannot_walk_ashore() {
    let report = turn_71();

    // "* Drones (14451)" is in the ocean at (20,40); "  South : desert (20,42)".
    let problem = plan(&report, "14451", at(20, 42)).expect_err("it would have to swim");

    assert!(
        matches!(
            problem,
            RouteProblem::OceanNeedsShip { coordinate, ref terrain }
                if coordinate == at(20, 40) && terrain == "ocean"
        ),
        "the refusal is about the hex it is standing in, not one along the way"
    );
}

/// A hex nobody has described can still be walked to: the player picks one on the map because a
/// friend named the coordinates, and refusing to say anything about getting there is no help.
///
/// The cost is a guess and says so. Every step through unexplored country carries the terrain of
/// the hex it was entered from - biomes cluster, which is the same assumption the order tracer
/// makes when it draws a written MOVE into the fog.
#[test]
fn a_destination_nobody_has_described_is_reached_by_estimate() {
    let report = turn_71();

    // "* Seven of Eight (18642)" stands in the mountain at (7,53), whose north neighbour (7,51) is
    // another mountain. (7,49) beyond it is unexplored.
    let route = plan(&report, "18642", at(7, 49)).expect("a route into the fog");

    assert_eq!(route.steps.len(), 2);
    assert!(
        !route.steps[0].estimated,
        "the first step is a hex the report describes"
    );
    assert!(
        route.steps[1].estimated,
        "the second is unexplored, so its terrain and cost are guesses"
    );
    assert_eq!(
        route.steps[1].terrain, "mountain",
        "the terrain of the hex it was entered from is carried forward"
    );
    assert_eq!(
        route.steps[1].cost, 2,
        "costed as the mountain it is taken for"
    );
    assert_eq!(route.total_cost, 4);
}

/// A hex out in the country between two islands of known ground, which is where an ally's
/// coordinates usually land.
///
/// The route runs from the known island across the fog to it. Only the first steps are described,
/// so most of what is reported is estimate.
#[test]
fn a_destination_out_in_the_fog_is_reached_across_it() {
    let report = turn_71();

    // (7,53) was visited and (15,63) was too, but everything between them - (11,57) among it - is
    // unheard of.
    let route = plan(&report, "18642", at(11, 57)).expect("a route through the fog");

    assert_eq!(route.steps.last().expect("a final step").to, at(11, 57));
    assert!(
        route.steps.iter().any(|step| step.estimated),
        "the country between them is unexplored"
    );
    assert_eq!(
        route.total_cost,
        route.steps.iter().map(|step| step.cost).sum::<u32>()
    );
}

/// A second island of described ground on the way, with fog on both sides of it.
///
/// The route crosses the gap, walks the island, and steps off its far end into the fog: three
/// guesses, not a detour of six round the outside of it. Ground the faction has actually seen is
/// worth using even when the way to it is guesswork, which means the search has to be able to come
/// back out of the fog as well as go into it.
#[test]
fn a_route_into_the_fog_uses_the_described_ground_it_passes() {
    let region = |terrain: &str, x: i32, y: i32, exits: &str| {
        format!("{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\nExits:\n{exits}\n\n")
    };

    let mut text = String::from("Foo (1) Report\n\n");
    // Where the unit stands, and its one described neighbour.
    text.push_str(&region(
        "plain",
        1,
        1,
        "  Southeast : plain (2,2) in Nowhere.",
    ));
    text.push_str("* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    // Printed with no exits: a list naming only Northwest would prove a wall on the Southeast side
    // the route leaves by (ah-wq2e.1), and naming (3,3) would take it out of the fog.
    text.push_str(&region("plain", 2, 2, ""));
    // An island two hexes of fog further on, described but joined to nothing the unit can see.
    text.push_str(&region(
        "plain",
        5,
        5,
        "  Southeast : plain (6,6) in Nowhere.",
    ));
    text.push_str(&region(
        "plain",
        6,
        6,
        "  Northwest : plain (5,5) in Nowhere.",
    ));

    let report = parse_report_full(&text);
    let route = plan(&report, "900", at(7, 7)).expect("a route across the gap");

    assert_eq!(route.steps.len(), 6, "six southeast steps");
    assert_eq!(
        route.steps.iter().filter(|step| step.estimated).count(),
        3,
        "the two hexes of the gap and the destination, and nothing else"
    );
    // (2,2) described, (3,3) and (4,4) the gap, then the island at (5,5) and (6,6).
    assert!(
        !route.steps[3].estimated && !route.steps[4].estimated,
        "the island in the middle is described ground and is walked as such"
    );
    assert_eq!(route.steps[3].to, at(5, 5));
    assert_eq!(route.steps[4].to, at(6, 6));
}

/// Guessing is for reaching what the map cannot describe. A hex it *can* describe is reached over
/// described ground or not at all: sending a walker round a known sea through hexes nobody has seen
/// - which may well be more sea - would be an invention presented as a plan.
#[test]
fn a_described_destination_is_never_reached_by_guessing_a_way_round() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : ocean (2,2) in Sea.\n\n");
    text.push_str("* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    text.push_str("ocean (2,2) in Sea.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (1,1) in Nowhere.\n  Southeast : plain (3,3) in Nowhere.\n\n",
    );
    text.push_str("plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : ocean (2,2) in Sea.\n");

    let report = parse_report_full(&text);
    let problem = plan(&report, "900", at(3, 3)).expect_err("the sea is in the way");

    assert!(
        matches!(problem, RouteProblem::OceanNeedsShip { .. }),
        "expected the sea to be named, got {problem:?}"
    );
}

/// The cost carried into the fog is the terrain the route left, not a fixed assumption: stepping
/// off a plain into unexplored country costs a plain, where stepping off a mountain costs a
/// mountain.
#[test]
fn a_step_into_the_fog_costs_what_the_hex_behind_it_costs() {
    let report = corridor(&["plain", "plain"]);

    // (1,1) and (2,2) are described; (3,3) beyond them is not.
    let route = plan(&report, "900", at(3, 3)).expect("a route into the fog");

    assert_eq!(route.steps.len(), 2);
    assert!(!route.steps[0].estimated);
    assert!(route.steps[1].estimated);
    assert_eq!(route.steps[1].terrain, "plain");
    assert_eq!(route.total_cost, 2, "two ordinary steps at one point each");
}

/// A destination far outside anything the faction has seen is still answered rather than searched
/// for forever. The search is bounded by the ground it knows, widened to hold the destination.
#[test]
fn a_destination_far_out_in_the_fog_is_still_answered() {
    let report = corridor(&["plain", "plain"]);
    let route = plan(&report, "900", at(41, 41)).expect("a long guess is still a route");

    assert_eq!(route.steps.last().expect("a final step").to, at(41, 41));
    assert_eq!(route.steps.len(), 40, "forty southeast steps");
    assert!(
        route.steps.iter().skip(1).all(|step| step.estimated),
        "everything past the described corridor is a guess"
    );
}

/// A unit heavier than all four of its capacities cannot be given a MOVE order at all, and the
/// planner says so before it looks for a route.
///
/// Asked of a unit **ashore**: `plan_route` puts the fleet question first on purpose, so a
/// passenger's refusal is the fleet's, not its own - see
/// `a_passenger_on_an_unsailable_fleet_is_refused_for_the_fleet`. This used to ask it of 13972 in
/// turn 71, which is aboard Frozen Tomb [194] and only answered `Overloaded` while that fleet
/// could not be priced (`ah-8myf`). The unit-level fact itself is pinned by
/// `graph::unit::a_unit_heavier_than_all_its_capacities_cannot_move`.
#[test]
fn an_overloaded_unit_is_refused_before_any_route_is_sought() {
    // "Weight: 10. Capacity: 0/0/0/0." - it can carry itself nowhere.
    let report = corridor_with(&["plain", "plain"], "0/0/0/0");
    let problem = plan(&report, "900", at(2, 2)).expect_err("it cannot move");

    assert!(matches!(problem, RouteProblem::Overloaded), "{problem:?}");
}

/// A unit standing in a fleet it does not own cannot give that fleet its course, so there is
/// nothing to plan for it: "the owner of a fleet must issue the SAIL order"
/// (`rules/movement_sailing`, `ah-ofra`). `13972` stands in Frozen Tomb [194], whose first listed
/// occupant - and so its owner, per `rules/world_structures` - is the foreign `A Tomb's Crew
/// (6311)`.
///
/// Ownership is tested before the weight and the crew, deliberately: which unit may give the order
/// at all is a more basic refusal than what the hull carries or how many sailors are aboard, and
/// neither figure is worth naming to a unit that cannot give the order. The crew figure this test
/// used to assert is carried by
/// [`the_crew_a_galley_of_forty_galleons_needs_is_ruleset_arithmetic`] instead.
#[test]
fn a_passenger_cannot_be_planned_for_the_fleet_it_rides() {
    let report = turn_71();
    let problem = plan(&report, "13972", at(7, 51)).expect_err("13972 does not own the fleet");

    let RouteProblem::NotFleetOwner { owner, .. } = &problem else {
        panic!("{problem:?}");
    };
    assert_eq!(owner, "A Tomb's Crew (6311)");
}

/// **`ah-8myf`.** Frozen Tomb [194] is written `Galley, 40 Galleons, 11 Galleys, 10 Balloons` and
/// states no `Sailors:` line, so its crew requirement is ruleset arithmetic over those hulls - 762
/// levels, against the nothing this faction has aboard. This is the fact
/// `a_passenger_on_an_unsailable_fleet_is_refused_for_the_fleet` carried before ownership came to
/// be tested first, and it needs no map and no planner.
#[test]
fn the_crew_a_galley_of_forty_galleons_needs_is_ruleset_arithmetic() {
    let report = turn_71();
    let fleet = report
        .regions
        .iter()
        .flat_map(|region| &region.structures)
        .find(|structure| structure.structure_id == "194")
        .expect("Frozen Tomb [194] is in the fixture");

    assert_eq!(
        atlantis_hud_core::movement::mode::sailing_requirement(fleet, Some(&ruleset())),
        Some(762)
    );
}

/// Planning is for units you can actually give orders to. A foreign unit also has no stated weight
/// or capacity, so there is nothing to plan with even if it were allowed.
#[test]
fn a_foreign_unit_cannot_be_planned_for() {
    let report = turn_71();
    let foreign = report
        .units()
        .find(|unit| !unit.own)
        .expect("the report is full of them");
    let map = MapKnowledge::from_report(&report);

    let problem = plan_route(&map, &ruleset(), foreign, at(7, 51)).expect_err("not yours to order");
    assert!(matches!(problem, RouteProblem::NotYourUnit));
}

#[test]
fn planning_a_route_to_where_the_unit_already_stands_says_so() {
    let report = turn_71();
    let problem = plan(&report, "18642", at(7, 53)).expect_err("it is already there");

    assert!(matches!(problem, RouteProblem::AlreadyThere));
}
