use super::support::{f42_t40, plan};
use crate::common::at;
use atlantis_hud_core::movement::plan::RouteProblem;
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::parse_report_full;

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
    // plain (3,3) was stood in and lists only land, so the fleet is told it touches no sea.
    assert_eq!(
        inland,
        RouteProblem::FleetLandingInland {
            coordinate: at(3, 3),
            terrain: "plain".to_string(),
        }
    );
}

/// A land hex known only by name, which no report places beside water, may or may not be coastal
/// (`rules/movement_sailing`) - and doubt about whether a landing is legal at all is a refusal.
#[test]
fn a_fleet_is_refused_a_named_hex_nothing_puts_beside_the_sea() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \\
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    text.push_str(
        "  * Sailors (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \\
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n\n",
    );
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : hills (3,3) in Inland.\n",
    );
    let report = parse_report_full(&text);

    let problem = plan(&report, "900", at(3, 3)).expect_err("nothing puts the hills by the sea");
    assert_eq!(
        problem,
        RouteProblem::FleetLandingCoastUnknown {
            coordinate: at(3, 3),
            terrain: "hills".to_string(),
        }
    );
}

/// A land hex nobody stood in is coastal when an ocean hex's report names it among its exits -
/// `rules/movement_sailing`: "A coastal region is defined as a non-ocean region with at least one
/// adjacent ocean region." The forest has no block of its own, so its only evidence of a shore is
/// the sea's report.
#[test]
fn a_fleet_lands_on_a_shore_only_the_sea_has_named() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : forest (2,2) in Coast.\n\n");
    text.push_str("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \\
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    text.push_str(
        "  * Sailors (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \\
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    let report = parse_report_full(&text);

    let route = plan(&report, "900", at(2, 2)).expect("the sea names the forest as its shore");
    assert_eq!(route.mode, MovementMode::Sail);
    assert_eq!(route.steps.len(), 1);
    assert_eq!(route.steps[0].to, at(2, 2));
    assert_eq!(route.steps[0].terrain, "forest");
    assert!(!route.steps[0].estimated);
    assert_eq!(route.steps[0].cost, 1);
    assert_eq!(route.order, "SAIL SE");
}
