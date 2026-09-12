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

use atlantis_hud_core::movement::graph::{Direction, MapKnowledge, RememberedRegion};
use atlantis_hud_core::movement::plan::{plan_route, CrewShortfall, RouteProblem};
use atlantis_hud_core::movement::rules::{MovementMode, Ruleset};
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;

const F42_T40: &str = atlantis_hud_fixtures::G3_F42_T40.text;
const F42_T41: &str = atlantis_hud_fixtures::G3_F42_T41.text;
const F42_T42: &str = atlantis_hud_fixtures::G3_F42_T42.text;

mod common;
use common::{at, ruleset, trident_ruleset};

fn turn_71() -> ParsedReport {
    parse_report_full(TURN_71)
}

/// Plans for one of the faction's own units, by id.
fn plan(
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    plan_against(&ruleset(), report, unit_id, destination)
}

/// Plans as `plan` does, against a world's own ruleset rather than the shipped one.
fn plan_against(
    ruleset: &Ruleset,
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let map = MapKnowledge::from_report(report);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(&map, ruleset, unit, destination)
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

/// A unit heavier than all four of its capacities cannot be given a MOVE order at all, and the
/// planner says so before it looks for a route.
///
/// Asked of a unit **ashore**: `plan_route` puts the fleet question first on purpose, so a
/// passenger's refusal is the fleet's, not its own - see
/// `a_passenger_on_an_unsailable_fleet_is_refused_for_the_fleet`. This used to ask it of 13972 in
/// turn 71, which is aboard Frozen Tomb [194] and only answered `Overloaded` while that fleet
/// could not be priced (`ah-8myf`). The unit-level fact itself is pinned by
/// `movement_graph::a_unit_heavier_than_all_its_capacities_cannot_move`.
#[test]
fn an_overloaded_unit_is_refused_before_any_route_is_sought() {
    // "Weight: 10. Capacity: 0/0/0/0." - it can carry itself nowhere.
    let report = corridor_with(&["plain", "plain"], "0/0/0/0");
    let problem = plan(&report, "900", at(2, 2)).expect_err("it cannot move");

    assert!(matches!(problem, RouteProblem::Overloaded), "{problem:?}");
}

/// Frozen Tomb [194] is written `Galley, 40 Galleons, 11 Galleys, 10 Balloons` and states no
/// `Sailors:` line, so its crew requirement is ruleset arithmetic over those hulls - 762 levels,
/// against the nothing this faction has aboard. A unit standing in it goes where the fleet goes or
/// nowhere, which is the answer the planner owes even for a passenger that is also overloaded
/// (`ah-8myf`).
#[test]
fn a_passenger_on_an_unsailable_fleet_is_refused_for_the_fleet() {
    let report = turn_71();
    let problem = plan(&report, "13972", at(7, 51)).expect_err("the fleet cannot sail");

    assert!(
        matches!(problem, RouteProblem::CrewCannotSail { required: 762, .. }),
        "{problem:?}"
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

/// The same corridor, with a Trident unit whose items decide what it can do in the water.
///
/// `items` goes verbatim into the unit's line, and `capacity` is the four-number line the report
/// would have printed for it - the inventory is what actually decides (`swim_ability` prefers it),
/// and the printed numbers are kept in step so the fixture does not contradict itself. A lizardman
/// is weight 10, walking capacity 5, swimming capacity 5 (`newage trident data/lizardman`); a
/// giant turtle weight 50, walking 20, riding 20, swimming 20 (`newage trident data/giant turtle`).
fn swimmer_corridor(terrains: &[&str], items: &str, weight: i64, capacity: &str) -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    for (index, terrain) in terrains.iter().enumerate() {
        let x = 1 + index as i32;
        let y = 1 + index as i32;
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
            text.push_str(&format!(
                "* Swimmer (900), Foo (1), {items}. Weight: {weight}. Capacity: {capacity}.\n\n"
            ));
        }
    }
    parse_report_full(&text)
}

/// [`plan`], for a world other than New Origins.
fn plan_in(
    report: &ParsedReport,
    ruleset: &atlantis_hud_core::movement::rules::Ruleset,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let map = MapKnowledge::from_report(report);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(&map, ruleset, unit, destination)
}

// ------------------------------------------------------- swimming (New Age: Trident)

/// `newage trident rules/movement_normal`: "Swimming units are restricted to coastal ocean regions
/// and lakes." The strait is coastal at both ends, so the lizardman simply swims it.
#[test]
fn a_lizardman_swims_across_the_coastal_strait() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "lizardman [LIZA]",
        10,
        "0/0/15/15",
    );
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("a swimmer swims");

    assert_eq!(route.mode, MovementMode::Walk, "swimming is not a speed");
    assert_eq!(route.steps.len(), 2);
    assert_eq!(route.steps[0].terrain, "ocean");
    assert!(route.steps[0].over_water);
    assert!(!route.steps[1].over_water);
}

#[test]
fn a_lizardman_may_stop_in_the_coastal_water() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "lizardman [LIZA]",
        10,
        "0/0/15/15",
    );
    let route = plan_in(&report, &trident_ruleset(), "900", at(2, 2))
        .expect("a swimmer may end its month in the water");

    assert_eq!(route.steps.len(), 1);
    assert!(route.steps[0].over_water);
}

/// A leader has a swimming capacity of 0 (`newage trident data/leader`), so nothing changes for it.
#[test]
fn a_leader_is_still_told_it_needs_a_ship() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD]",
        10,
        "0/0/15/0",
    );
    let problem =
        plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect_err("a leader cannot swim");

    assert!(
        matches!(problem, RouteProblem::OceanNeedsShip { ref terrain, .. } if terrain == "ocean"),
        "{problem:?}"
    );
}

/// A leader with a giant turtle and four wood: weight 10 + 50 + 20 = 80, and a swimming capacity of
/// 0 + 70 = 70. It can swim, but not carrying this much, and a ship is not what it needs.
#[test]
fn a_swimmer_carrying_too_much_is_told_the_numbers() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD], giant turtle [TURT], 4 wood [WOOD]",
        80,
        "0/70/85/70",
    );
    let problem = plan_in(&report, &trident_ruleset(), "900", at(3, 3))
        .expect_err("it cannot swim at that weight");

    assert_eq!(
        problem,
        RouteProblem::SwimLoadTooHeavy {
            coordinate: at(2, 2),
            terrain: "ocean".to_string(),
            capacity: 70,
            load: 80,
            destination: false,
        }
    );
}

#[test]
fn the_destination_half_names_the_hex_the_player_clicked() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD], giant turtle [TURT], 4 wood [WOOD]",
        80,
        "0/70/85/70",
    );
    let problem = plan_in(&report, &trident_ruleset(), "900", at(2, 2))
        .expect_err("it cannot swim at that weight");

    assert_eq!(
        problem,
        RouteProblem::SwimLoadTooHeavy {
            coordinate: at(2, 2),
            terrain: "ocean".to_string(),
            capacity: 70,
            load: 80,
            destination: true,
        }
    );
}

/// The rule names lakes as open whatever their depth, and the Trident ruleset's `unrestricted`
/// says so.
#[test]
fn a_lake_is_open_to_a_swimmer_whatever_its_depth() {
    let report = swimmer_corridor(
        &["plain", "lake", "plain"],
        "lizardman [LIZA]",
        10,
        "0/0/15/15",
    );
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("a lake is open");

    assert_eq!(route.steps.len(), 2);
    assert!(route.steps[0].over_water);
}

/// New Origins carries no swimming paragraph at all, so its swimmers are refused as before.
#[test]
fn new_origins_still_refuses_every_swimmer() {
    let report = swimmer_corridor(
        &["plain", "ocean", "plain"],
        "leader [LEAD]",
        10,
        "0/0/15/15",
    );
    let problem = plan_in(&report, &ruleset(), "900", at(3, 3))
        .expect_err("New Origins has no swimming rule");

    assert!(
        matches!(problem, RouteProblem::OceanNeedsShip { .. }),
        "{problem:?}"
    );
}

/// The sea and the shore: `(2,2)` coastal, `(3,3)` deep - its six neighbours are all water - and
/// `(4,4)` water of a depth nothing can tell, named by `(3,3)` alone.
fn sea_and_shore(items: &str, weight: i64, capacity: &str) -> ParsedReport {
    parse_report_full(&format!(
        "Foo (1) Report\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : ocean (2,2) in Atlantis Ocean.\n\n\
         * Swimmer (900), Foo (1), {items}. Weight: {weight}. Capacity: {capacity}.\n\n\
         ocean (2,2) in Atlantis Ocean.\n\n\
         Exits:\n  \
         Northwest : plain (1,1) in Nowhere.\n  \
         North : ocean (2,0) in Atlantis Ocean.\n  \
         Northeast : ocean (3,1) in Atlantis Ocean.\n  \
         Southeast : ocean (3,3) in Atlantis Ocean.\n  \
         South : ocean (2,4) in Atlantis Ocean.\n  \
         Southwest : ocean (1,3) in Atlantis Ocean.\n\n\
         ocean (3,3) in Atlantis Ocean.\n\n\
         Exits:\n  \
         North : ocean (3,1) in Atlantis Ocean.\n  \
         Northeast : ocean (4,2) in Atlantis Ocean.\n  \
         Southeast : ocean (4,4) in Atlantis Ocean.\n  \
         South : ocean (3,5) in Atlantis Ocean.\n  \
         Southwest : ocean (2,4) in Atlantis Ocean.\n  \
         Northwest : ocean (2,2) in Atlantis Ocean.\n"
    ))
}

#[test]
fn deep_water_refuses_a_swimmer_with_no_sea_creatures() {
    let report = sea_and_shore("lizardman [LIZA]", 10, "0/0/15/15");
    let problem = plan_in(&report, &trident_ruleset(), "900", at(3, 3))
        .expect_err("deep water is closed to it");

    assert_eq!(
        problem,
        RouteProblem::DeepWaterNeedsSeaCreatures {
            coordinate: at(3, 3),
            terrain: "ocean".to_string(),
            borne: 0,
            load: 10,
            destination: true,
        }
    );
}

/// Three lizardmen and a turtle weigh 80; the turtle bears 70 of it, which is not the whole.
#[test]
fn sea_creatures_that_fall_short_are_named() {
    let report = sea_and_shore(
        "3 lizardman [LIZA], giant turtle [TURT]",
        80,
        "0/70/85/115",
    );
    let problem = plan_in(&report, &trident_ruleset(), "900", at(3, 3))
        .expect_err("its creatures cannot bear it entire");

    assert_eq!(
        problem,
        RouteProblem::DeepWaterNeedsSeaCreatures {
            coordinate: at(3, 3),
            terrain: "ocean".to_string(),
            borne: 70,
            load: 80,
            destination: true,
        }
    );
}

/// "a unit carried by sea creatures able to bear its whole weight rides out into deep water
/// safely" - exactly its whole weight is enough.
#[test]
fn sea_creatures_bearing_exactly_the_whole_weight_ride_out() {
    let report = sea_and_shore(
        "2 lizardman [LIZA], giant turtle [TURT]",
        70,
        "0/70/80/100",
    );
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("it rides out");

    assert_eq!(route.steps.len(), 2);
    assert!(route.steps[1].over_water);
}

#[test]
fn sea_creatures_bearing_more_than_enough_ride_out() {
    let report = sea_and_shore("lizardman [LIZA], giant turtle [TURT]", 60, "0/70/75/85");
    let route = plan_in(&report, &trident_ruleset(), "900", at(3, 3)).expect("it rides out");

    assert_eq!(route.steps.len(), 2);
}

/// `(4,4)` is named by one hex alone, so five of its six directions are unaccounted for and
/// nothing can say whether it is deep. Refused rather than guessed at.
#[test]
fn water_of_unknown_depth_is_refused_rather_than_guessed() {
    let report = sea_and_shore("lizardman [LIZA]", 10, "0/0/15/15");
    let problem = plan_in(&report, &trident_ruleset(), "900", at(4, 4))
        .expect_err("nothing can say how deep it is");

    assert_eq!(
        problem,
        RouteProblem::WaterDepthUnknown {
            coordinate: at(4, 4),
            terrain: "ocean".to_string(),
        }
    );
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
    // The refusal names the world's water, not the dry hex: `blocks` refuses a fleet an inland hex
    // for a reason that has nothing to do with water, and "the plain is in the way, and crossing it
    // needs a ship" would be a contradiction in front of the player.
    assert_eq!(
        inland,
        RouteProblem::OceanNeedsShip {
            coordinate: at(3, 3),
            terrain: "ocean".to_string(),
        }
    );
}

// ------------------------------------------------------- an overloaded fleet

/// A Longship docked in an ocean hex at (1,1) with a coastal plain at (2,2) one step southeast, so
/// every case below plans `at(2, 2)` and expects `SAIL SE`. The same map as
/// `a_sea_route_can_end_on_a_coastal_land_hex_but_not_an_inland_one`.
///
/// `ship_fields` is what follows `Longship` on the ship line - `"; Load: 0/150; Sailors: 4/4;
/// MaxSpeed: 4"`, or `""` for a hull that states nothing. `aboard` is one own unit per entry as
/// `(unit_id, weight, sail level)`, each one man, so a unit supplies its level once. `strangers` is
/// one foreign unit per entry, which states no weight at all.
fn docked_longship(
    ship_fields: &str,
    aboard: &[(&str, i64, u32)],
    strangers: &[&str],
) -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str(&format!("+ Ship [329] : Longship{ship_fields}.\n"));
    for (id, weight, level) in aboard {
        text.push_str(&format!(
            "  * Sailors ({id}), Foo (1), sharing, centaur [CTAU]. Weight: {weight}. \
             Capacity: 0/70/70/0. Skills: sailing [SAIL] {level} (90).\n"
        ));
    }
    for id in strangers {
        text.push_str(&format!(
            "  - Scout ({id}), The Filras (14), avoiding, behind, gnoll [GNOL].\n"
        ));
    }
    text.push('\n');
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : ocean (1,1) in Sea.\n");
    parse_report_full(&text)
}

/// "A fleet can only move if the total weight of everything aboard does not exceed the fleet's
/// capacity" (`rules/movement_sailing`, looked up 2026-09-12), so a route for a fleet already too
/// heavy is a voyage that cannot happen.
#[test]
fn an_overloaded_fleet_is_refused_before_a_route_is_offered() {
    let report = docked_longship(
        "; Load: 0/150; Sailors: 4/4; MaxSpeed: 4",
        &[("900", 50, 2), ("901", 160, 2)],
        &[],
    );

    let problem = plan(&report, "900", at(2, 2)).expect_err("210 aboard on a capacity of 150");
    assert_eq!(
        problem,
        RouteProblem::FleetOverloaded {
            load: 210,
            capacity: 150,
            crew: None,
        }
    );
}

/// The rule is *does not exceed*, so exactly full sails.
#[test]
fn a_fleet_loaded_to_exactly_its_capacity_still_sails() {
    let report = docked_longship(
        "; Load: 0/150; Sailors: 4/4; MaxSpeed: 4",
        &[("900", 50, 2), ("901", 100, 2)],
        &[],
    );

    let route = plan(&report, "900", at(2, 2)).expect("150 aboard on a capacity of 150 sails");
    assert_eq!(route.mode, MovementMode::Sail);
    assert_eq!(route.order, "SAIL SE");
    assert!(
        !route.load_unchecked,
        "both the load and the capacity were known"
    );
}

/// One refusal naming both faults, so the player does not shift cargo, re-plan, and meet a second
/// refusal nobody mentioned.
#[test]
fn an_overloaded_and_undercrewed_fleet_is_refused_for_both_faults() {
    let report = docked_longship(
        "; Load: 0/150; Sailors: 4/4; MaxSpeed: 4",
        &[("900", 50, 1), ("901", 160, 1)],
        &[],
    );

    let problem = plan(&report, "900", at(2, 2)).expect_err("too heavy and short-crewed at once");
    assert_eq!(
        problem,
        RouteProblem::FleetOverloaded {
            load: 210,
            capacity: 150,
            crew: Some(CrewShortfall {
                required: 4,
                available: 2,
            }),
        }
    );
}

/// A stranger's unit aboard weighs something the report never stated and the hull states no `Load:`
/// line either, so the check cannot be made - the route stands, and says so.
#[test]
fn a_fleet_whose_load_cannot_be_weighed_is_planned_with_the_check_unmade() {
    let report = docked_longship("", &[("900", 50, 2), ("901", 50, 2)], &["700"]);

    let route = plan(&report, "900", at(2, 2)).expect("the route stands, unchecked");
    assert_eq!(route.mode, MovementMode::Sail);
    assert!(
        route.load_unchecked,
        "neither the units aboard nor the hull could give a load"
    );
}

/// "Capacity unknown but load known" is a state of its own: the hull states its `Sailors:` and
/// `MaxSpeed:`, so the fleet can be priced and sailed, but its kind is one the ruleset carries no
/// item for and it states no `Load:` line, so nothing can say what it holds. The panel cannot judge
/// what it has only half of.
#[test]
fn a_fleet_whose_capacity_is_unknown_is_planned_with_the_check_unmade() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str("+ Ship [329] : Dhow; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 4 (90).\n\n",
    );
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : ocean (1,1) in Sea.\n");
    let report = parse_report_full(&text);

    let route = plan(&report, "900", at(2, 2)).expect("the route stands, unchecked");
    assert_eq!(route.mode, MovementMode::Sail);
    assert!(
        route.load_unchecked,
        "the load is 50 but no source gives a capacity to weigh it against"
    );
}

/// The sailing rule says nothing about a walker, so a walker never carries the caution.
#[test]
fn a_walking_unit_never_carries_the_fleet_caution() {
    let report = turn_71();

    let route = plan(&report, "18642", at(7, 51)).expect("a walker steps north");
    assert!(!route.load_unchecked);
}

/// Both worlds carry `LONG` with `cargoCapacity: 150` and the same sentence on their own
/// `rules/movement_sailing` (`newage trident rules/movement_sailing`, looked up 2026-09-12), so the
/// guard is not an Origins-only reading.
#[test]
fn trident_refuses_an_overloaded_fleet_on_its_own_rules() {
    let report = docked_longship(
        "; Load: 0/150; Sailors: 4/4; MaxSpeed: 4",
        &[("900", 50, 2), ("901", 160, 2)],
        &[],
    );
    let trident = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
        .expect("the committed Trident ruleset loads");

    let problem = plan_against(&trident, &report, "900", at(2, 2))
        .expect_err("210 aboard on a capacity of 150");
    assert_eq!(
        problem,
        RouteProblem::FleetOverloaded {
            load: 210,
            capacity: 150,
            crew: None,
        }
    );
}

// ------------------------------------------------------- a flying fleet

/// One synthetic report, differing only in the hull named on the ship and the crew it states, so
/// the four hulls of `ah-g6gn.2` are one argument apart. An ocean hex, a coastal plain and an
/// inland plain, each described in full - `is_coastal` reads a hex's own stated exits, so a hex
/// known only by name is never coastal.
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

/// Asserts the route from the ocean to the inland plain that only a flying hull may take.
fn assert_flown_inland(route: &atlantis_hud_core::movement::plan::RoutePlan) {
    assert_eq!(route.mode, MovementMode::Sail);
    assert_eq!(route.steps.len(), 2);
    assert_eq!(route.steps[0].to, at(2, 2));
    assert_eq!(route.steps[1].to, at(3, 3));
    assert_eq!(route.steps[1].terrain, "plain");
    assert!(
        route.steps.iter().all(|step| step.cost == 1),
        "rules/movement_sailing: for a fleet to enter any region only costs one movement point"
    );
    assert_eq!(route.months.len(), 1);
    assert_eq!(route.order, "SAIL SE SE");
}

/// `data/BALL`: "Balloon [BALL]. This is a flying 'ship' with a capacity of 100 and a speed of 4
/// hexes per month." Land refuses a flying hull nothing - neither the coastal plain nor the inland
/// one behind it.
#[test]
fn a_balloon_is_planned_over_land_like_the_flying_ship_it_is() {
    let report = parse_report_full(&report_with("Balloon", "3/3"));
    let route = plan(&report, "900", at(3, 3)).expect("a balloon is not stopped by land");
    assert_flown_inland(&route);
}

/// One flying hull among several is enough - `movement::mode::fleet_flies`'s reading, which this
/// bead takes as it stands. The navigator accepted the cost on 2026-09-09: the galleons fly too.
#[test]
fn a_fleet_with_a_balloon_among_its_galleons_is_planned_over_land() {
    let report = parse_report_full(&report_with("Fleet, 4 Galleons, 1 Balloon", "4/4"));
    let route = plan(&report, "900", at(3, 3)).expect("a fleet carrying a balloon flies");
    assert_flown_inland(&route);
}

/// A hull no committed catalogue carries: `fleet_flies` answers `None`, "cannot say", and the map
/// reads that exactly as Problems does - anything but a definite no frees the fleet from land.
/// Reachable rather than theoretical because the structure states its own `Sailors:` and
/// `MaxSpeed:`, which beat the catalogue.
#[test]
fn a_hull_the_catalogue_cannot_read_is_planned_over_land_like_a_flier() {
    let report = parse_report_full(&report_with("Skycutter", "3/3"));
    let route = plan(&report, "900", at(3, 3)).expect("an unreadable hull is not bound to water");
    assert_flown_inland(&route);
}

// ------------------------------------------------------- the sailing rule's step test

/// Fixture A of `ah-g6gn.1`: `forest (2,2)` and `forest (3,3)` are neighbours and both coastal,
/// and `ocean (2,4)` touches both, so a legal way round by sea exists. Built rather than taken
/// from a committed report for the same reason as
/// `a_sea_route_can_end_on_a_coastal_land_hex_but_not_an_inland_one`: `is_coastal` reads a hex's
/// own stated exits, so every hex on the way must be described in full.
fn coastal_pair_with_a_way_round() -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : forest (2,2) in Coast.\n\n");
    text.push_str("forest (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : forest (3,3) in Coast.\n  \
         South : ocean (2,4) in Sea.\n\n",
    );
    text.push_str(&longship());
    text.push_str("ocean (2,4) in Sea.\n\n");
    text.push_str(
        "Exits:\n  North : forest (2,2) in Coast.\n  Northeast : forest (3,3) in Coast.\n\n",
    );
    text.push_str("forest (3,3) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : forest (2,2) in Coast.\n  Southwest : ocean (2,4) in Sea.\n",
    );
    parse_report_full(&text)
}

/// Fixture B: fixture A with the sea between the two hexes no longer touching `(3,3)`, which is
/// kept coastal by a sea nothing else reaches. There is no legal way round at all.
fn coastal_pair_with_no_way_round() -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : forest (2,2) in Coast.\n\n");
    text.push_str("forest (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : forest (3,3) in Coast.\n  \
         South : ocean (2,4) in Sea.\n\n",
    );
    text.push_str(&longship());
    text.push_str("ocean (2,4) in Sea.\n\n");
    text.push_str("Exits:\n  North : forest (2,2) in Coast.\n\n");
    text.push_str("forest (3,3) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : forest (2,2) in Coast.\n  Southeast : ocean (4,4) in Sea.\n\n",
    );
    text.push_str("ocean (4,4) in Sea.\n\n");
    text.push_str("Exits:\n  Northwest : forest (3,3) in Coast.\n");
    parse_report_full(&text)
}

/// Fixture A with a plain walking unit standing ashore in `forest (2,2)` alongside the fleet.
fn coastal_pair_with_a_way_round_and_a_walker() -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : forest (2,2) in Coast.\n\n");
    text.push_str("forest (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : forest (3,3) in Coast.\n  \
         South : ocean (2,4) in Sea.\n\n",
    );
    text.push_str("* Walker (902), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    text.push_str(&longship());
    text.push_str("ocean (2,4) in Sea.\n\n");
    text.push_str(
        "Exits:\n  North : forest (2,2) in Coast.\n  Northeast : forest (3,3) in Coast.\n\n",
    );
    text.push_str("forest (3,3) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : forest (2,2) in Coast.\n  Southwest : ocean (2,4) in Sea.\n",
    );
    parse_report_full(&text)
}

/// A Longship crewed by two Sailors of SAIL 2 - exactly the four levels the hull needs.
fn longship() -> String {
    let mut text =
        String::from("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    text.push_str(
        "  * Sailors (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n\n",
    );
    text
}

/// The direct step is coastal-to-coastal, which the sailing rule allows in none of its three
/// forms, so the planner offers the two-step route by sea instead - at whatever it costs.
#[test]
fn a_fleet_goes_round_by_sea_rather_than_hopping_between_two_coastal_hexes() {
    let report = coastal_pair_with_a_way_round();
    let route = plan(&report, "900", at(3, 3)).expect("the sea route is legal");

    assert_eq!(route.mode, MovementMode::Sail);
    assert_eq!(route.steps.len(), 2, "out to sea and back in again");
    assert_eq!(route.steps[0].to, at(2, 4));
    assert_eq!(route.steps[1].to, at(3, 3));
    assert_eq!(route.order, "SAIL S NE");
}

/// The new rule is gated on `MovementMode::Sail`; a walker between the same two land hexes is
/// untouched.
#[test]
fn a_walker_between_two_land_hexes_is_unaffected() {
    // Fixture A with a walker ashore in the same `forest (2,2)` the fleet is refused from, so this
    // is a direct A/B against the very step
    // `a_fleet_goes_round_by_sea_rather_than_hopping_between_two_coastal_hexes` sends round.
    let report = coastal_pair_with_a_way_round_and_a_walker();
    let route = plan(&report, "902", at(3, 3)).expect("a walker may cross land");

    assert_eq!(route.mode, MovementMode::Walk);
    assert_eq!(route.steps.len(), 1, "straight across, not round by sea");
    assert_eq!(route.steps[0].to, at(3, 3));
}

/// With no way round by sea the refusal names the rule, not the map: "Nothing the faction has seen
/// joins those two hexes up" reads plainly wrong to a player looking at two adjacent hexes the
/// faction has both seen.
#[test]
fn a_hop_with_no_way_round_by_sea_names_the_sailing_rule() {
    let report = coastal_pair_with_no_way_round();
    let problem = plan(&report, "900", at(3, 3)).expect_err("the sailing rule refuses the step");

    assert_eq!(
        problem,
        RouteProblem::SailNeedsOcean {
            from: at(2, 2),
            from_terrain: "forest".to_string(),
            to: at(3, 3),
            to_terrain: "forest".to_string(),
        }
    );
}

/// `RouteProblem`'s TypeScript union is hand-written rather than generated, so this is the only
/// thing standing between the Rust enum's field names and what the planner panel reads.
#[test]
fn the_sailing_refusal_serialises_the_names_the_typescript_expects() {
    let value = serde_json::to_value(RouteProblem::SailNeedsOcean {
        from: at(2, 2),
        from_terrain: "forest".to_string(),
        to: at(3, 3),
        to_terrain: "forest".to_string(),
    })
    .expect("the refusal serialises");
    let object = value.as_object().expect("a JSON object");

    assert_eq!(object["kind"], "sailNeedsOcean");
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["from", "fromTerrain", "kind", "to", "toTerrain"]);
}

// ------------------------------------------------------- lakes, in New Age: Trident

// Trident `rules/movement_sailing`: "Lakes count as water for this purpose, and a region
// bordering one counts as its shore, so fleets may also sail between a lake and the land around
// it." New Origins' sailing section says nothing of the kind, so the same map answers differently
// in the two worlds - which is what the control test at the end of this section pins.

fn trident() -> atlantis_hud_core::movement::rules::Ruleset {
    atlantis_hud_core::movement::rules::Ruleset::from_json(
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
    )
    .expect("the committed Trident ruleset parses and validates")
}

/// Plans with a ruleset of the caller's choosing, which `plan` above does not - it is hardwired to
/// New Origins, where a lake is genuinely dry land.
fn plan_ruleset(
    ruleset: &atlantis_hud_core::movement::rules::Ruleset,
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let map = MapKnowledge::from_report(report);
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(&map, ruleset, unit, destination)
}

/// plain (1,1) - lake (2,2) - plain (3,3), each hex stating the exits that name its neighbours, so
/// the graph does not stop at the fringe. `unit` is the line to drop into the first hex.
fn lake_in_a_line(unit: &str) -> ParsedReport {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : lake (2,2) in Nowhere.\n\n");
    text.push_str(unit);
    text.push_str("\n\nlake (2,2) in Nowhere.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (1,1) in Nowhere.\n  \
         Southeast : plain (3,3) in Nowhere.\n\n",
    );
    text.push_str("plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : lake (2,2) in Nowhere.\n");
    parse_report_full(&text)
}

const WALKER: &str = "* Boots (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 0/0/15/0.";
const FLIER: &str = "* Wings (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 15/0/15/0.";

#[test]
fn a_walker_refused_by_a_lake_names_the_lake() {
    let report = lake_in_a_line(WALKER);

    let in_the_way = plan_ruleset(&trident(), &report, "900", at(3, 3))
        .expect_err("the lake is between the unit and the far plain");
    assert_eq!(
        in_the_way,
        RouteProblem::OceanNeedsShip {
            coordinate: at(2, 2),
            terrain: "lake".to_string(),
        }
    );

    let clicked = plan_ruleset(&trident(), &report, "900", at(2, 2))
        .expect_err("the lake itself needs a ship");
    assert_eq!(
        clicked,
        RouteProblem::DestinationNeedsShip {
            coordinate: at(2, 2),
            terrain: "lake".to_string(),
        }
    );
}

/// The control: the same map, the shipped New Origins ruleset. A lake there is ordinary land, so
/// nothing about this bead may reach that world.
#[test]
fn a_new_origins_walker_still_walks_across_a_lake() {
    let report = lake_in_a_line(WALKER);

    let route = plan_ruleset(&ruleset(), &report, "900", at(2, 2))
        .expect("a lake is dry land in New Origins");
    assert_eq!(route.mode, MovementMode::Walk);
    assert!(
        !route.steps[0].over_water,
        "nothing on this map is water in New Origins"
    );
}

#[test]
fn a_flier_crosses_a_lake_and_marks_the_wet_step() {
    let report = lake_in_a_line(FLIER);

    let route = plan_ruleset(&trident(), &report, "900", at(3, 3))
        .expect("a flier may cross water, it just may not stop on it");
    assert_eq!(route.mode, MovementMode::Fly);
    assert_eq!(route.steps.len(), 2);
    assert!(route.steps[0].over_water, "the lake is step one");
    assert!(!route.steps[1].over_water, "the far plain is dry");
}

#[test]
fn a_flier_whose_month_ends_over_a_lake_is_refused() {
    let report = lake_in_a_line(FLIER);

    let problem = plan_ruleset(&trident(), &report, "900", at(2, 2))
        .expect_err("a unit that ends a turn over water drowns");
    assert_eq!(
        problem,
        RouteProblem::FlightWouldEndOverOcean {
            coordinate: at(2, 2),
            terrain: "lake".to_string(),
        }
    );
}

/// "a 1 man unit with level four sailing skill can sail a Longship alone"
/// (`newage trident rules/movement_sailing`), and a region bordering a lake counts as its shore.
#[test]
fn a_fleet_sails_from_the_shore_onto_a_lake() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : lake (2,2) in Nowhere.\n\n");
    text.push_str("+ Ship [10] : Longship; Load: 10/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 4 (180).\n\n",
    );
    text.push_str("lake (2,2) in Nowhere.\n\n");
    text.push_str("Exits:\n  Northwest : plain (1,1) in Nowhere.\n");
    let report = parse_report_full(&text);

    let route = plan_ruleset(&trident(), &report, "900", at(2, 2))
        .expect("a fleet may sail between a lake and the land around it");
    assert_eq!(route.mode, MovementMode::Sail);
    assert!(
        route.order.starts_with("SAIL"),
        "the order should be a SAIL, was {}",
        route.order
    );
    assert!(
        route.steps[0].over_water,
        "core states the fact for every mode; the panel decides who is shown it"
    );
}

// ------------------------------------------------- the isthmus rule: which side a fleet may leave by

// `rules/movement_sailing`, in every committed world: "Ships may not sail through single hex land
// masses and must leave via the same side they entered or a side adjacent to that one." A fleet
// sailing SE out of `ocean (1,1)` into `plain (2,2)` entered through the plain's NW side, so it may
// leave NW, N or SW - and SE, NE and S are all refused.

/// The mockup's corridor: `ocean (1,1)` —SE→ `plain (2,2)` —`leaving`→ an ocean hex beyond, which
/// touches nothing else. Every hex states the exits that name its neighbours, since a stated exit
/// is the only adjacency the search reads between two described hexes - so the corridor is the
/// whole map and there is no way round.
///
/// `structure` is dropped into the plain's own block: `""` for a bare neck, `"+ The Cut [3] :
/// Canal.\n"` for one with a canal standing in it.
fn neck(leaving: Direction, structure: &str) -> ParsedReport {
    parse_report_full(&neck_text(leaving, structure))
}

/// [`neck`]'s report as text, so a test can rewrite the fleet's speed before parsing it.
fn neck_text(leaving: Direction, structure: &str) -> String {
    let (dx, dy) = leaving.offset();
    let far = at(2 + dx, 2 + dy);
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str(&longship());
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(&format!(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  {} : ocean ({},{}) in Sea.\n\n",
        leaving.label(),
        far.x,
        far.y
    ));
    text.push_str(structure);
    if !structure.is_empty() {
        text.push('\n');
    }
    text.push_str(&format!("ocean ({},{}) in Sea.\n\n", far.x, far.y));
    text.push_str(&format!(
        "Exits:\n  {} : plain (2,2) in Coast.\n",
        leaving.opposite().label()
    ));
    text
}

/// Where the corridor above puts the ocean beyond the neck, for a given leaving side.
fn beyond(leaving: Direction) -> Coordinate {
    let (dx, dy) = leaving.offset();
    at(2 + dx, 2 + dy)
}

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

// ------------------------------------------------- a canal opens the neck, at its grade's price

// `newage/trident rules/economy_canals`: "When a Canal is present, ships may sail through the
// region in any direction, bypassing the normal restriction that prevents sailing through an
// isthmus. ... A Canal of cut stone slows ships passing through it: the through-pass costs two
// movement points where ordinary sailing costs one. A Mystic Canal, engineered from rootstone, lets
// ships pass at full speed."

const STONE_CANAL: &str = "+ The Cut [3] : Canal.\n";
const MYSTIC_CANAL: &str = "+ The Cut [3] : Mystic Canal.\n";

#[test]
fn a_stone_canal_opens_the_neck_and_prices_the_pass_at_two() {
    let report = neck(Direction::Southeast, STONE_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(route.steps.len(), 2);
    assert_eq!(route.steps[0].to, at(2, 2));
    assert_eq!(route.steps[0].cost, 2, "the through-pass costs two");
    assert_eq!(route.steps[0].canal, Some("Canal".to_string()));
    assert_eq!(route.steps[1].cost, 1);
    assert_eq!(route.steps[1].canal, None);
    assert_eq!(route.total_cost, 3);
    assert_eq!(route.months.len(), 1);
    assert_eq!(route.order, "SAIL SE SE");
}

#[test]
fn a_mystic_canal_passes_at_full_speed() {
    let report = neck(Direction::Southeast, MYSTIC_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(
        route.steps[0].cost, 1,
        "a mystic canal passes at full speed"
    );
    assert_eq!(route.steps[0].canal, Some("Mystic Canal".to_string()));
    assert_eq!(route.total_cost, 2);
}

/// A canal cannot fall down or sail away, so one seen months ago still opens the neck. The current
/// report does not describe the plain at all - only its two neighbours name it - which is exactly
/// the case `structures_ever_seen` exists for.
#[test]
fn a_remembered_canal_still_opens_the_neck() {
    let plain = neck(Direction::Southeast, STONE_CANAL)
        .regions
        .iter()
        .find(|region| region.coordinate == at(2, 2))
        .expect("the corridor describes the plain")
        .clone();

    let mut text = String::from("Atlantis Report For:\nFoo (1)\nDecember, Year 6\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str(&longship());
    text.push_str("ocean (3,3) in Sea.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n");
    let current = parse_report_full(&text);

    let map = MapKnowledge::from_remembered(
        &current,
        &[RememberedRegion {
            region: plain,
            last_seen_turn: 1,
        }],
    );
    let unit = current
        .units()
        .find(|unit| unit.unit_id == "900")
        .expect("the fleet is aboard");
    let route =
        plan_route(&map, &trident(), unit, at(3, 3)).expect("a remembered canal still counts");

    assert_eq!(route.steps[0].canal, Some("Canal".to_string()));
    assert_eq!(route.steps[0].cost, 2);
}

/// Entering is not passing through: a fleet that stops in the canal region pays the ordinary cost.
#[test]
fn a_fleet_that_stops_in_a_canal_region_pays_the_ordinary_cost() {
    let report = neck(Direction::Southeast, STONE_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(2, 2)).expect("the plain is coastal");

    assert_eq!(route.steps.len(), 1);
    assert_eq!(route.steps[0].cost, 1);
    assert_eq!(route.steps[0].canal, None);
}

/// Nor has a fleet passed through when it turns out by a side the rule already allows.
#[test]
fn a_fleet_that_turns_out_of_a_canal_region_pays_the_ordinary_cost() {
    let report = neck(Direction::North, STONE_CANAL);
    let route =
        plan_ruleset(&trident(), &report, "900", beyond(Direction::North)).expect("N is allowed");

    assert_eq!(route.steps[0].cost, 1);
    assert_eq!(route.steps[0].canal, None);
}

/// The premium is *moved* onto the step the player sees, never added: what the panel lists must
/// still add up to what the panel totals.
#[test]
fn the_displayed_step_costs_still_sum_to_the_total() {
    let report = neck(Direction::Southeast, STONE_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(
        route.steps.iter().map(|step| step.cost).sum::<u32>(),
        route.total_cost
    );
}

/// The months are split from the costs the game charges, so a two-point fleet stops *in* the canal
/// region rather than being refused the hex the game lets it reach. This is the test that fails if
/// the premium is charged on entry instead of on the pass.
#[test]
fn a_month_that_cannot_afford_the_stone_pass_ends_in_the_canal_region() {
    let report = parse_report_full(
        &neck_text(Direction::Southeast, STONE_CANAL).replace("MaxSpeed: 4", "MaxSpeed: 2"),
    );
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(
        route.months.len(),
        2,
        "two points buy the entry and no more"
    );
    assert_eq!(route.months[0].ends_at, at(2, 2));
}

#[test]
fn the_neck_refusal_serialises_the_names_the_typescript_expects() {
    let value = serde_json::to_value(RouteProblem::IsthmusNeedsCanal {
        coordinate: at(2, 2),
        terrain: "plain".to_string(),
    })
    .expect("the refusal serialises");
    let object = value.as_object().expect("a JSON object");

    assert_eq!(object["kind"], "isthmusNeedsCanal");
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["coordinate", "kind", "terrain"]);
}

/// A fleet would use the faster canal. The name breaks a tie so the answer never depends on the
/// order a report listed the two in.
#[test]
fn a_mystic_canal_and_a_stone_one_in_one_region_take_the_faster() {
    let report = neck(
        Direction::Southeast,
        "+ The Cut [3] : Canal.\n+ The Deep Cut [4] : Mystic Canal.\n",
    );
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(route.steps[0].cost, 1);
    assert_eq!(route.steps[0].canal, Some("Mystic Canal".to_string()));
}
