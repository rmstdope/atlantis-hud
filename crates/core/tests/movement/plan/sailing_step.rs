use super::support::{longship, plan};
use crate::common::at;
use atlantis_hud_core::movement::plan::RouteProblem;
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

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

#[test]
fn the_landing_refusals_serialise_the_names_the_typescript_expects() {
    for (problem, kind) in [
        (
            RouteProblem::FleetLandingInland {
                coordinate: at(2, 2),
                terrain: "plain".to_string(),
            },
            "fleetLandingInland",
        ),
        (
            RouteProblem::FleetLandingCoastUnknown {
                coordinate: at(2, 2),
                terrain: "plain".to_string(),
            },
            "fleetLandingCoastUnknown",
        ),
    ] {
        let value = serde_json::to_value(problem).expect("the refusal serialises");
        let object = value.as_object().expect("a JSON object");

        assert_eq!(object["kind"], kind);
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["coordinate", "kind", "terrain"]);
    }
}
