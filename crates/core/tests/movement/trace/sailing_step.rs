use super::support::{document, trace_over};
use crate::common::at;
use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::trace_orders_for_remembered_report;

/// Fixture A of `ah-g6gn.1`: `forest (2,2)` and `forest (3,3)` are neighbours and both coastal,
/// and `ocean (2,4)` touches both. Built rather than taken from a committed report: `is_coastal`
/// reads a hex's own stated exits, so both ends of the step must be described in full, and no
/// committed report carries such a pair.
fn coastal_pair_report() -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : forest (2,2) in Coast.\n\n");
    text.push_str("forest (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  Southeast : forest (3,3) in Coast.\n  \
         South : ocean (2,4) in Sea.\n\n",
    );
    text.push_str("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    text.push_str(
        "  * Sailors (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n\n",
    );
    text.push_str("ocean (2,4) in Sea.\n\n");
    text.push_str(
        "Exits:\n  North : forest (2,2) in Coast.\n  Northeast : forest (3,3) in Coast.\n\n",
    );
    text.push_str("forest (3,3) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : forest (2,2) in Coast.\n  Southwest : ocean (2,4) in Sea.\n",
    );
    text
}

/// `rules/movement_sailing`: "A fleet can move from an ocean region to another ocean region, or
/// from a coastal region to an ocean region, or from an ocean region to a coastal region." All
/// three have ocean at one end, so a step from one coastal land hex straight into another is none
/// of them - and the trace dots the line from that step on.
#[test]
fn a_sail_between_two_coastal_hexes_is_dotted_from_that_step() {
    let path = trace_over(&coastal_pair_report(), "900", "SAIL SE")
        .path
        .expect("a traced path");

    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(3, 3));
    assert_eq!(
        path.mode,
        Some(atlantis_hud_core::movement::rules::MovementMode::Sail)
    );
    assert_eq!(
        path.blocked_from,
        Some(0),
        "the coastal-to-coastal step is itself the first the game refuses"
    );
}

/// The guard against a rule that refuses every fleet: a step out to sea from the same coastal hex
/// is one of the three the rule allows, and is drawn solid.
#[test]
fn a_sail_out_to_sea_from_a_coastal_hex_is_still_undotted() {
    let path = trace_over(&coastal_pair_report(), "900", "SAIL S")
        .path
        .expect("a traced path");

    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(2, 4));
    assert_eq!(path.blocked_from, None, "coastal to ocean is allowed");
}

/// A written SAIL onto a land hex known only from the sea's report is legal - the ocean hex beside
/// it makes it coastal (`rules/movement_sailing`) - so the step is drawn solid.
#[test]
fn a_written_sail_onto_a_shore_only_the_sea_has_named_is_drawn_solid() {
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

    let path = trace_over(&text, "900", "SAIL SE")
        .path
        .expect("a traced path");

    assert_eq!(path.steps.len(), 1);
    assert_eq!(path.steps[0].to, at(2, 2));
    assert_eq!(
        path.blocked_from, None,
        "ocean to a named coastal hex is allowed"
    );
}

/// The tracer and the planner must mark the same hexes as water - they share `Ruleset::is_water`,
/// and this is what pins that they share its answer too. Trident counts a lake as water
/// (`newage trident rules/movement_sailing`), so a flight over one says so on the step itself.
#[test]
fn a_traced_flight_marks_its_water_steps() {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : lake (2,2) in Nowhere.\n\n");
    text.push_str("* Wings (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 15/0/15/0.\n\n");
    text.push_str("lake (2,2) in Nowhere.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (1,1) in Nowhere.\n  \
         Southeast : plain (3,3) in Nowhere.\n\n",
    );
    text.push_str("plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : lake (2,2) in Nowhere.\n");

    let path = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &text,
        "[]",
        "900",
        &document("900", "MOVE SE SE"),
    )
    .expect("the ruleset loads")
    .path
    .expect("a traced path");

    assert_eq!(path.steps.len(), 2);
    assert!(path.steps[0].over_water, "the lake is water in Trident");
    assert!(!path.steps[1].over_water, "the far plain is dry");
}
