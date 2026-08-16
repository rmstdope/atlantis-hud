//! Acceptance tests for planning a route.
//!
//! Most cases come from the committed turn 71 report of faction 95. Note what a single report
//! cannot show: every hex the faction visited has neighbours it only knows by name, and a hex
//! known by name has no exits of its own, so a report with few, scattered regions stops at its
//! fringe - which is faction 95's case. A bigger report does not: turn 42 of faction 42 (game 3)
//! has contiguous visited ground and supports routes of many steps on its own.
//!
//! What memory adds, and what a single report - however big - cannot show on its own, is reaching
//! ground the current report does not describe: a hex named only in passing, with no exits of its
//! own, until an earlier turn that stood in it is remembered alongside the current one. That case
//! lives in its own section below, built from game 3's faction 42 across turns 40, 41 and 42.

use atlantis_hud_core::movement::graph::{MapKnowledge, RememberedRegion};
use atlantis_hud_core::movement::plan::{plan_route, RouteProblem};
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;

const F42_T40: &str = atlantis_hud_fixtures::G3_F42_T40.text;
const F42_T41: &str = atlantis_hud_fixtures::G3_F42_T41.text;
const F42_T42: &str = atlantis_hud_fixtures::G3_F42_T42.text;

mod common;
use common::{at, ruleset};

fn turn_71() -> ParsedReport {
    parse_report_full(TURN_71)
}

/// Plans for one of the faction's own units, by id.
fn plan(
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let map = MapKnowledge::from_report(report);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(&map, &ruleset(), unit, destination)
}

// ------------------------------------------------------- what the report can show

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
        RouteProblem::OceanNeedsShip { coordinate } if coordinate == at(8, 52)
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
            RouteProblem::OceanNeedsShip { coordinate } if coordinate == at(20, 40)
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
    text.push_str(&region(
        "plain",
        2,
        2,
        "  Northwest : plain (1,1) in Nowhere.",
    ));
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

/// "Thirteen of Eight (13972) ... Weight: 17. Capacity: 0/0/15/0." - heavier than all four of its
/// capacities, so the game will not give it a MOVE order at all.
#[test]
fn an_overloaded_unit_is_refused_before_any_route_is_sought() {
    let report = turn_71();
    let problem = plan(&report, "13972", at(7, 51)).expect_err("it cannot move");

    assert!(matches!(problem, RouteProblem::Overloaded));
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

// ------------------------------------------------------- what needs a synthetic map

/// A chain of hexes, each naming the next, so a route can be longer than one step.
///
/// `terrains` runs west to east along a row; the unit starts in the first.
fn corridor(terrains: &[&str]) -> ParsedReport {
    corridor_with(terrains, "0/0/15/0")
}

/// The same corridor, with the unit's capacity chosen so its mode of travel can be varied.
fn corridor_with(terrains: &[&str], capacity: &str) -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    for (index, terrain) in terrains.iter().enumerate() {
        let x = 1 + index as i32;
        let y = 1 + index as i32; // each step is southeast: (+1,+1)
        text.push_str(&format!(
            "{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\n"
        ));
        text.push_str("Exits:\n");
        if index > 0 {
            let previous = terrains[index - 1];
            text.push_str(&format!(
                "  Northwest : {previous} ({},{}) in Nowhere.\n",
                x - 1,
                y - 1
            ));
        }
        if index + 1 < terrains.len() {
            let next = terrains[index + 1];
            text.push_str(&format!(
                "  Southeast : {next} ({},{}) in Nowhere.\n",
                x + 1,
                y + 1
            ));
        }
        text.push('\n');
        if index == 0 {
            // "Weight: 10. Capacity: 0/0/15/0." is the fixture's own leader-sized walker; the
            // caller varies the capacity to change how the unit travels.
            text.push_str(&format!(
                "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: {capacity}.\n\n"
            ));
        }
    }
    parse_report_full(&text)
}

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

// ------------------------------------------------------- what memory adds, on real data

/// Game 3, faction 42 ("The Disinherited Knights"): three consecutive real turns, committed by
/// ah-dyi. t42 is current; t40 and t41 are remembered.
fn f42_t40() -> ParsedReport {
    parse_report_full(F42_T40)
}

fn f42_t41() -> ParsedReport {
    parse_report_full(F42_T41)
}

fn f42_t42() -> ParsedReport {
    parse_report_full(F42_T42)
}

/// Plans for one of the faction's own units, by id, against a caller-built map.
fn plan_with(
    map: &MapKnowledge,
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(map, &ruleset(), unit, destination)
}

/// Turns t40 and t41 into the remembered regions `from_remembered` expects, built straight from
/// `report.regions` - the same shortcut `movement/request.rs` already takes for a test.
fn remembered(reports: &[(&ParsedReport, u32)]) -> Vec<RememberedRegion> {
    reports
        .iter()
        .flat_map(|(report, turn)| {
            report.regions.iter().map(move |region| RememberedRegion {
                region: region.clone(),
                last_seen_turn: *turn,
            })
        })
        .collect()
}

/// `tundra (41,3) in Huykash` is a region t40 visited and neither t41 nor t42 describes; t42 knows
/// it only as an exit of `forest (40,2)`, so a named hex with no exits of its own. `tundra (42,2)`
/// is joined to the rest of the map only through it. From t42 alone there is no way there; with
/// t40 remembered, (41,3) brings its exits back and the route exists.
#[test]
fn a_remembered_turn_opens_a_route_the_current_report_cannot_find() {
    let t42 = f42_t42();

    let current_only = MapKnowledge::from_report(&t42);
    let problem = plan_with(&current_only, &t42, "10293", at(42, 2))
        .expect_err("t42 alone never heard of (42,2)'s exits");
    assert!(
        matches!(problem, RouteProblem::NoKnownRoute),
        "expected no known route, got {problem:?}"
    );

    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));
    let route = plan_with(&accumulated, &t42, "10293", at(42, 2))
        .expect("t40 remembered brings (41,3)'s exits back");

    assert_eq!(route.mode, MovementMode::Ride);
    assert_eq!(route.steps.len(), 2);
    assert!(route.steps.iter().all(|step| step.terrain == "tundra"));
    assert!(
        route.steps.iter().all(|step| !step.estimated),
        "both hexes are named by a report, not guessed"
    );
    assert_eq!(route.steps[0].cost, 2);
    assert_eq!(route.steps[1].cost, 2);
    assert_eq!(route.total_cost, 4);
    assert_eq!(route.months.len(), 1, "four points buy exactly one month");
}

/// The state the bead calls stale: a hex remembered from an earlier turn than the one on screen.
/// It exists only because a hex the current report merely names was once actually visited.
#[test]
fn a_remembered_hex_keeps_the_turn_it_was_last_seen_in() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));

    let stale = accumulated.hex(at(41, 3)).expect("remembered from t40");
    assert_eq!(stale.last_seen_turn, Some(40));
    assert!(stale.visited, "t40 actually stood in it");

    let current = accumulated.hex(at(40, 2)).expect("described by t42");
    assert_eq!(current.last_seen_turn, Some(42));

    let current_only = MapKnowledge::from_report(&t42);
    assert!(
        !current_only.hex(at(41, 3)).is_some_and(|hex| hex.visited),
        "t42 alone only names (41,3), it never stood there"
    );
}

/// "Lookout (12195)" takes the same two tundra steps as the woodsmen above, each costing 2, but
/// with a walker's two movement points a month rather than a rider's four: each step exactly fills
/// one month, so the route takes two months with nothing carried over.
#[test]
fn a_remembered_route_can_take_more_than_one_month() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));

    let route = plan_with(&accumulated, &t42, "12195", at(42, 2)).expect("a walker's route");

    assert_eq!(route.mode, MovementMode::Walk);
    assert_eq!(route.total_cost, 4);
    assert_eq!(route.months.len(), 2, "four points at two a month");
    assert_eq!(
        route.months[0].ends_at,
        at(41, 3),
        "the first month spends its two points on the first step"
    );
}

/// Three steps starting from `tundra (40,0)`, crossing both a hex the current turn describes and
/// one it only remembers: `Scout (1512)` walks south into `forest (40,2)` (described by t42),
/// southeast into `tundra (41,3)` (remembered from t40), then northeast into `tundra (42,2)`
/// (named by t42, reachable only because (41,3) brought its exits back).
#[test]
fn a_route_crosses_both_the_current_turn_and_a_remembered_one() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));

    let route =
        plan_with(&accumulated, &t42, "1512", at(42, 2)).expect("a three-step route across both");

    assert_eq!(route.steps.len(), 3);
    assert_eq!(
        route.total_cost, 6,
        "three tundra/forest steps at two apiece"
    );
    assert_eq!(route.months.len(), 3, "six points at two a month");
    assert_eq!(
        route.steps[1].to,
        at(41, 3),
        "the middle step is the remembered hex"
    );
    assert!(
        route.steps.iter().all(|step| !step.estimated),
        "every hex on the way is named by a report"
    );
}

/// Remembering t41 alone leaves no route: (41,3) appears only in t40. This pins that
/// `from_remembered` needs the specific turn that saw a hex, not merely "an earlier one".
#[test]
fn remembering_the_wrong_turn_still_finds_no_route() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t41(), 41)]));

    let problem =
        plan_with(&accumulated, &t42, "10293", at(42, 2)).expect_err("t41 never saw (41,3) either");
    assert!(matches!(problem, RouteProblem::NoKnownRoute));
}

// ------------------------------------------------------- sea routes

/// "+ Ship [329] : Longship; Load: 110/150; Sailors: 4/4; MaxSpeed: 4." (g3-f42-t40.rep:1120), with
/// two crew each holding SAIL 2 - exactly the four levels the longship needs. The boundary case the
/// fixture hands us: not one level to spare.
#[test]
fn a_crewed_longship_is_planned_a_sea_route() {
    let report = f42_t40();

    // "South : ocean (49,5) in Fu'ihogh Sea." from the forest the longship is docked in.
    let route = plan(&report, "11125", at(49, 5)).expect("the crew is exactly enough");

    assert_eq!(route.mode, MovementMode::Sail);
    assert_eq!(route.steps.len(), 1);
    assert_eq!(
        route.total_cost, 1,
        "a fleet's flat cost, not the terrain premium"
    );
    assert!(!route.steps[0].road, "roads never apply to a fleet");
    assert_eq!(
        route.months.len(),
        1,
        "MaxSpeed 4 covers one flat-cost step easily"
    );
    assert_eq!(route.order, "SAIL S");
}

/// A single Longship (`sailingSkill: 4` in the ruleset) with only one crew holding SAIL 1: the
/// fleet exists and can be priced by the ruleset, but the crew falls two levels short.
#[test]
fn an_undercrewed_fleet_names_the_missing_skill() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("forest (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  South : ocean (1,3) in Nowhere.\n\n");
    text.push_str("+ Ship [10] : Longship.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 1 (30).\n\n",
    );
    text.push_str("ocean (1,3) in Nowhere.\n\n");
    text.push_str("Exits:\n  North : forest (1,1) in Nowhere.\n");
    let report = parse_report_full(&text);

    let problem = plan(&report, "900", at(1, 3)).expect_err("one level short of four");
    assert_eq!(
        problem,
        RouteProblem::CrewCannotSail {
            required: 4,
            available: 1
        }
    );
}

/// A hull the ruleset has never heard of, with no server-stated `Sailors:`/`MaxSpeed:` either,
/// must never be guessed at - the unit is planned as though it were not aboard anything at all,
/// which for a unit with no stated weight/capacity means "mobility unstated".
#[test]
fn an_unknown_hull_falls_back_to_the_land_question() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Nowhere.\n\n");
    text.push_str("+ Ship [10] : Skiff.\n");
    text.push_str("  * Sailors (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    text.push_str("plain (2,2) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : plain (1,1) in Nowhere.\n");
    let report = parse_report_full(&text);

    // The unit's own Weight/Capacity line is stated, so it is planned as an ordinary walker rather
    // than refused - falling back to land planning "as if not aboard", not to a guess.
    let route = plan(&report, "900", at(2, 2)).expect("falls back to walking");
    assert_eq!(route.mode, MovementMode::Walk);
}

/// A land destination must be coastal for a fleet to enter it: "A coastal region is defined as a
/// non-ocean region with at least one adjacent ocean region." Built rather than taken from the
/// fixture, so both the coastal and the inland hex are hexes the map fully describes.
#[test]
fn a_sea_route_can_end_on_a_coastal_land_hex_but_not_an_inland_one() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
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
    let report = parse_report_full(&text);

    let coastal = plan(&report, "900", at(2, 2)).expect("plain (2,2) has an ocean neighbour");
    assert_eq!(coastal.mode, MovementMode::Sail);

    let inland = plan(&report, "900", at(3, 3)).expect_err("plain (3,3) has no water neighbour");
    assert!(matches!(inland, RouteProblem::OceanNeedsShip { .. }));
}
