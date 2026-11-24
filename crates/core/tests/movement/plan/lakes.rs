//! Trident `rules/movement_sailing`: "Lakes count as water for this purpose, and a region
//! bordering one counts as its shore, so fleets may also sail between a lake and the land around
//! it." New Origins' sailing section says nothing of the kind, but its engine treats a lake as water
//! all the same (ah-qpud9), so both worlds are asserted here.

use super::support::{plan_ruleset, trident};
use crate::common::{at, ruleset};
use atlantis_hud_core::movement::plan::RouteProblem;
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

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

/// New Origins treats a lake as water too, although its rules page never says so: the engine gives
/// `lake` the similar type `R_OCEAN` (`../Atlantis gamedata.cpp`, the lake row of the terrain table),
/// and `monthorders.cpp` stops a walker at a region of that type - "Discovers that ... is lake."
/// (ah-qpud9).
#[test]
fn a_new_origins_walker_refused_by_a_lake_names_the_lake() {
    let report = lake_in_a_line(WALKER);

    let in_the_way = plan_ruleset(&ruleset(), &report, "900", at(3, 3))
        .expect_err("the lake is between the unit and the far plain");
    assert_eq!(
        in_the_way,
        RouteProblem::OceanNeedsShip {
            coordinate: at(2, 2),
            terrain: "lake".to_string(),
        }
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

/// A Longship, its sailors and a lake beside their plain: (1,1) plain - (2,2) lake.
fn a_fleet_beside_a_lake() -> ParsedReport {
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
    parse_report_full(&text)
}

/// "a 1 man unit with level four sailing skill can sail a Longship alone"
/// (`newage trident rules/movement_sailing`), and a region bordering a lake counts as its shore.
#[test]
fn a_fleet_sails_from_the_shore_onto_a_lake() {
    let route = plan_ruleset(&trident(), &a_fleet_beside_a_lake(), "900", at(2, 2))
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

/// New Origins: SAIL refuses only a region that is not `IsCoastalOrLakeside`
/// (`../Atlantis monthorders.cpp`, "SAIL: Can't sail inland."), and that counts a lake as water
/// whatever `LAKESIDE_IS_COASTAL` says (`../Atlantis aregion.cpp`). So the lake's shore is a shore
/// for a fleet there too (ah-qpud9).
#[test]
fn a_new_origins_fleet_sails_from_the_shore_onto_a_lake() {
    let route = plan_ruleset(&ruleset(), &a_fleet_beside_a_lake(), "900", at(2, 2))
        .expect("a New Origins fleet may sail between a lake and the land around it");
    assert_eq!(route.mode, MovementMode::Sail);
    assert!(
        route.steps[0].over_water,
        "the lake is water in New Origins"
    );
}
