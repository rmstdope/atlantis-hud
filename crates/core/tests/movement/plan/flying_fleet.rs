use super::support::plan;
use crate::common::at;
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::parse_report_full;

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
