//! `common::fleet_that_sails` and `common::assert_fleet_sails`, the shared fixture for a fleet the
//! rules let sail (`ah-l20e`).
//!
//! `rules/movement_sailing`: *"A fleet can only move if the total weight of everything aboard does
//! not exceed the fleet's capacity ... Also, there must be enough sailors aboard (using the SAIL
//! order), to sail the fleet, or it will not go anywhere."* Seven departure tests sailed fleets that
//! broke one or the other, and passed only until the check was enforced (`ah-zbtx`). The builder
//! sizes a fleet from the hull's own data so a new test cannot repeat that, and the assertion is the
//! sailing check itself, so a fixture that drifts fails as a broken fixture.

mod common;

use common::{assert_fleet_sails, fleet_that_sails};

/// `data/LONG`: "This is a ship with a capacity of 150 and a speed of 4 hexes per month. This ship
/// requires a total of 4 levels of sailing skill to sail."
#[test]
fn a_longship_is_sized_from_its_own_data() {
    let fleet = fleet_that_sails(&common::ruleset(), "329", "Longship").captain(
        "Captain (900), Foo (1), human [HUMN]. Weight: 10. Capacity: 0/0/15/0.",
        1,
    );

    assert_eq!(fleet.capacity(), 150);
    assert_eq!(fleet.sailing_requirement(), 4);
    assert_eq!(
        fleet.text(),
        "+ Ship [329] : Longship; Load: 10/150; Sailors: 4/4; MaxSpeed: 4.\n\
         \x20\x20* Captain (900), Foo (1), human [HUMN]. Weight: 10. Capacity: 0/0/15/0. \
         Skills: sailing [SAIL] 4 (300).\n"
    );
}

/// A level is held by each of a unit's men (`rules/movement_sailing`: "the sailing skill increases
/// the usefulness of a unit proportionally"), so four men need one level each, and three need two.
#[test]
fn a_captain_of_several_men_shares_the_requirement_between_them() {
    let captain = |men: i64| {
        fleet_that_sails(&common::ruleset(), "329", "Longship")
            .captain(
                &format!(
                    "Captain (900), Foo (1), {men} humans [HUMN]. Weight: {}.",
                    men * 10
                ),
                men,
            )
            .text()
    };

    assert!(
        captain(4).contains("Skills: sailing [SAIL] 1 (30)."),
        "{}",
        captain(4)
    );
    assert!(
        captain(3).contains("Skills: sailing [SAIL] 2 (90)."),
        "{}",
        captain(3)
    );
}

#[test]
fn every_unit_aboard_counts_towards_the_load() {
    let text = fleet_that_sails(&common::ruleset(), "235", "Raft")
        .captain("Captain (900), Foo (1), human [HUMN]. Weight: 10.", 1)
        .aboard("Passenger (901), Foo (1), 2 humans [HUMN]. Weight: 20.")
        .text();

    assert!(
        text.starts_with("+ Ship [235] : Raft; Load: 30/450; Sailors: 2/2;"),
        "{text}"
    );
    assert!(
        text.ends_with("  * Passenger (901), Foo (1), 2 humans [HUMN]. Weight: 20.\n"),
        "{text}"
    );
}

#[test]
#[should_panic(expected = "over its capacity")]
fn an_overloaded_fleet_is_refused_by_the_builder() {
    fleet_that_sails(&common::ruleset(), "329", "Longship")
        .captain("Captain (900), Foo (1), human [HUMN]. Weight: 10.", 1)
        .aboard("Cargo (901), Foo (1), 10 humans [HUMN], 100 stone [STON]. Weight: 6100.")
        .text();
}

#[test]
#[should_panic(expected = "states no weight")]
fn a_unit_without_a_weight_is_refused_by_the_builder() {
    fleet_that_sails(&common::ruleset(), "329", "Longship")
        .captain("Captain (900), Foo (1), human [HUMN]. Weight: 10.", 1)
        .aboard("Stranger (901), Foo (1), human [HUMN].")
        .text();
}

#[test]
#[should_panic(expected = "no captain")]
fn a_fleet_without_a_captain_is_refused_by_the_builder() {
    fleet_that_sails(&common::ruleset(), "329", "Longship").text();
}

/// A coastal forest with an ocean to the south, and `fleet` lying in it.
fn coast_with(fleet: &str) -> String {
    format!(
        "Foo (1) Report\n\n\
         forest (2,2) in Coast, 10 peasants (orcs), $5.\n\n\
         Exits:\n  South : ocean (2,4) in Sea.\n\n\
         * Porter (950), Foo (1), 10 humans [HUMN], 100 stone [STON]. Weight: 5100.\n\
         {fleet}\n\
         ocean (2,4) in Sea.\n\n\
         Exits:\n  North : forest (2,2) in Coast.\n"
    )
}

fn built_longship() -> String {
    fleet_that_sails(&common::ruleset(), "329", "Longship")
        .captain(
            "Captain (900), Foo (1), human [HUMN]. Weight: 10. Capacity: 0/0/15/0.",
            1,
        )
        .text()
}

#[test]
fn a_built_fleet_sails() {
    assert_fleet_sails(
        &coast_with(&built_longship()),
        "unit 900\nSAIL S\n",
        &common::ruleset(),
    );
}

/// The control for the crew half: the same captain a level short of the Longship's four.
#[test]
#[should_panic(expected = "fleet-undercrewed")]
fn an_undercrewed_fleet_does_not_pass() {
    let short = built_longship().replace("sailing [SAIL] 4 (300)", "sailing [SAIL] 3 (180)");
    assert_fleet_sails(
        &coast_with(&short),
        "unit 900\nSAIL S\n",
        &common::ruleset(),
    );
}

/// The control for the load half: the porter's 5100 boards a hull that carries 150.
#[test]
#[should_panic(expected = "fleet-overloaded")]
fn an_overloaded_fleet_does_not_pass() {
    assert_fleet_sails(
        &coast_with(&built_longship()),
        "unit 900\nSAIL S\nunit 950\nENTER 329\n",
        &common::ruleset(),
    );
}

/// The control for a fleet nobody sails: the sailing check judges only a hull someone SAILs, so
/// with no SAIL it raises nothing, and that silence must not pass for a fleet that sails.
#[test]
#[should_panic(expected = "no unit issues SAIL")]
fn a_fleet_nobody_sails_does_not_pass() {
    assert_fleet_sails(
        &coast_with(&built_longship()),
        "unit 900\nWORK\n",
        &common::ruleset(),
    );
}
