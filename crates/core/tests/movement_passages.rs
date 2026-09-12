//! Acceptance tests for reading a turn's orders for crossings of an inner passage.
//!
//! Nothing in a report says where an inner passage comes out (`rules/move`, direction 4: "IN, which
//! will move through an inner passage in the structure that the unit is currently in"). The only
//! honest evidence is our own faction's crossing, and this is the half that reads the claim; the
//! next turn's report answers it on the screen.

use atlantis_hud_core::movement::fleet::OrderedUnits;
use atlantis_hud_core::movement::passages::passage_claims;
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::parse_report_full;

const NEXUS_TURN_ZERO: &str = atlantis_hud_fixtures::G4_F17_T0.text;

/// A plain hex holding one `Shaft [1]` with our own unit `5` standing inside it.
fn report_with_a_shaft() -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  North : plain (1,-1) in Coast.\n\n");
    text.push_str("+ Shaft [1] : Shaft, contains an inner location.\n");
    text.push_str("  * Digger (5), Foo (1), leader [LEAD]. Weight: 10.\n");
    text.push_str("  - Stranger (9), Bar (2), leader [LEAD]. Weight: 10.\n");
    text.push_str("+ Ship [2] : Galley; Load: 0/100; Sailors: 0/4; MaxSpeed: 4.\n");
    text.push_str("  * Passenger (7), Foo (1), leader [LEAD]. Weight: 10.\n");
    text
}

/// The claims of one orders document read against that report.
fn claims(orders: &str) -> Vec<atlantis_hud_core::movement::passages::PassageClaim> {
    let report = parse_report_full(&report_with_a_shaft());
    let ordered = OrderedUnits::from_document(orders);
    passage_claims(&report, &ordered)
}

#[test]
fn a_passage_ordered_from_the_reported_hex_is_claimed() {
    let claimed = claims("unit 5\nMOVE IN\n");

    assert_eq!(claimed.len(), 1, "one crossing was ordered");
    assert_eq!(claimed[0].unit_id, "5");
    assert_eq!(claimed[0].entry, Coordinate { x: 1, y: 1, z: 1 });
    assert_eq!(claimed[0].structure_id, "1");
    assert_eq!(claimed[0].structure, "Shaft [1]");
}

/// `ENTER` runs before anything moves, so a unit that names the shaft it is already in has still
/// crossed from the hex the report found it in (`OrderedUnits::structure_of`).
#[test]
fn an_enter_by_number_before_the_passage_is_still_claimed() {
    let claimed = claims("unit 5\nMOVE 1 IN\n");

    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].structure_id, "1");
}

/// A direction followed by a structure number in one route names a structure again, so
/// `first_passage` hands back a `structure_id` even though the unit has left the hex the report
/// found it in - and only the check on the steps *before* the passage rejects it.
#[test]
fn a_step_before_an_entered_structure_is_not_claimed() {
    assert_eq!(claims("unit 5\nMOVE N 1 IN\n"), vec![]);
}

/// A fleet holds no inner passage, and a passenger writes no `SAIL` of its own - so without the
/// report's own `contains an inner location` clause, an `IN` aboard a hull that sails away would
/// write the hull's next hex down as the far side of the fleet.
#[test]
fn a_structure_with_no_inner_location_is_not_claimed() {
    assert_eq!(claims("unit 7\nMOVE IN\n"), vec![]);
}

/// A direction before the `IN` leaves the hex, so the passage is entered somewhere this report
/// cannot name.
#[test]
fn a_step_before_the_passage_is_not_claimed() {
    assert_eq!(claims("unit 5\nMOVE N IN\n"), vec![]);
}

/// A step after the passage moves the unit on from wherever it came out, so next turn's hex is no
/// longer the far side.
#[test]
fn a_step_after_the_passage_is_not_claimed() {
    assert_eq!(claims("unit 5\nMOVE IN SE\n"), vec![]);
}

/// Only our own faction's orders are evidence about our own faction's units.
#[test]
fn a_foreign_unit_is_not_claimed() {
    assert_eq!(claims("unit 9\nMOVE IN\n"), vec![]);
}

/// `rules/world_nexus`: a unit entering a portal "will be transported to a region of the matching
/// terrain type. The region chosen is somewhat random", decided when the turn runs - so one
/// crossing says nothing whatever about the next.
#[test]
fn a_nexus_gate_is_never_claimed() {
    let report = parse_report_full(NEXUS_TURN_ZERO);
    let ordered = OrderedUnits::from_document("unit 666\nMOVE 1 IN\n");

    assert_eq!(passage_claims(&report, &ordered), vec![]);
}
