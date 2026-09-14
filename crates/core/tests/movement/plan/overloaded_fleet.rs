use super::support::{plan, plan_against, turn_71};
use crate::common::at;
use atlantis_hud_core::movement::plan::{CrewShortfall, RouteProblem};
use atlantis_hud_core::movement::rules::{MovementMode, Ruleset};
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

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
