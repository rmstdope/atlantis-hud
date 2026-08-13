//! Acceptance tests for the risk a route runs.
//!
//! Every figure is counted out of the committed turn 71 report. The heuristic is deliberately
//! crude - #8 rules out a combat simulator - so what these tests pin is that it reads the right
//! things and bands them sensibly, not that it predicts battles.

use atlantis_hud_core::movement::graph::MapKnowledge;
use atlantis_hud_core::movement::risk::{assess_hex, assess_route, RiskLevel};
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::report::model::{Coordinate, ReportUnit};
use atlantis_hud_core::report::{classify_units, parse_report_full, ParsedReport};

const TURN_71: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-g7-f95-t71.rep");
const RULESET: &str = include_str!("../../../config/public/ruleset.json");

fn at(x: i32, y: i32) -> Coordinate {
    Coordinate { x, y, z: 1 }
}

fn ruleset() -> Ruleset {
    Ruleset::from_json(RULESET).expect("the committed ruleset loads")
}

/// Classified, because the risk heuristic weighs men and a unit's men are only exact once the
/// catalogue has been consulted.
fn classified() -> ParsedReport {
    let mut report = parse_report_full(TURN_71);
    classify_units(&mut report, &ruleset());
    report
}

fn unit_of<'a>(report: &'a ParsedReport, unit_id: &str) -> &'a ReportUnit {
    report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit")
}

/// "* Seven of Eight (18642)" is one man, standing in a hex holding 1438 foreign men.
#[test]
fn a_hex_full_of_strangers_is_dangerous_to_one_man() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    let risk = assess_hex(&map, &ruleset(), at(7, 53), unit_of(&report, "18642"));

    assert_eq!(risk.level, RiskLevel::High);
    assert_eq!(risk.hostile_strength, 1438);
    assert_eq!(risk.own_strength, 1);
    assert!(
        risk.reason.contains("1438"),
        "the reason should carry the figure: {}",
        risk.reason
    );
}

/// An empty hex is the safest thing there is, and the heuristic should say so plainly rather than
/// reporting a small number.
#[test]
fn an_empty_hex_is_as_safe_as_it_gets() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    // "1:19,39 ocean" holds nothing at all.
    let risk = assess_hex(&map, &ruleset(), at(19, 39), unit_of(&report, "18642"));

    assert_eq!(risk.level, RiskLevel::Low);
    assert_eq!(risk.hostile_strength, 0);
    assert_eq!(risk.foreign_units, 0);
}

/// The middle band, and the one that needs monsters to reach it.
///
/// "1:20,40" holds one foreign man and six water elementals; "* Drones (14451)" standing there is
/// fifty lizardmen. A monster counts for the hits it takes to kill, so six elementals at twenty
/// hits are worth a hundred and twenty men - a little over twice the fifty, which is medium.
#[test]
fn monsters_count_for_what_they_take_to_kill() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    let risk = assess_hex(&map, &ruleset(), at(20, 40), unit_of(&report, "14451"));

    assert_eq!(risk.monsters, 6, "six water elementals");
    assert_eq!(
        risk.hostile_strength, 121,
        "one man and six twenty-hit monsters"
    );
    assert_eq!(risk.own_strength, 50);
    assert_eq!(risk.level, RiskLevel::Medium);
}

/// Your own units are not a threat to you, however many of them are standing about.
#[test]
fn your_own_units_are_never_counted_against_you() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    // "1:18,44" holds one foreign scout of one man and fifty of your own lizardmen.
    let risk = assess_hex(&map, &ruleset(), at(18, 44), unit_of(&report, "15571"));

    assert_eq!(risk.hostile_strength, 1, "only the foreign scout");
    assert_eq!(risk.level, RiskLevel::Low);
}

/// A hex nobody has described cannot be assessed, and guessing that it is safe is the one answer
/// that could get a unit killed.
#[test]
fn an_undescribed_hex_is_not_reported_as_safe() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    let risk = assess_hex(&map, &ruleset(), at(99, 99), unit_of(&report, "18642"));

    assert!(risk.unknown, "nothing is known about it");
    assert_eq!(
        risk.level,
        RiskLevel::Medium,
        "an unassessable hex is not low risk"
    );
    assert!(risk.reason.to_lowercase().contains("nothing is known"));
}

/// A hex known only by name has no unit list, which is not the same as having no units.
#[test]
fn a_hex_known_only_by_name_cannot_be_assessed_either() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    // "  Southwest : jungle (9,51) in Maput." - named by an exit, never visited.
    let risk = assess_hex(&map, &ruleset(), at(9, 51), unit_of(&report, "18642"));

    assert!(risk.unknown);
    assert_eq!(risk.level, RiskLevel::Medium);
}

/// Guards are worth saying out loud: they can forbid a unit passage outright.
#[test]
fn guards_are_named_in_the_reason() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    // Fifteen foreign units are on guard in the mountain at (7,53).
    let risk = assess_hex(&map, &ruleset(), at(7, 53), unit_of(&report, "18642"));

    assert_eq!(risk.guards, 15);
    assert!(risk.reason.contains("guard"), "reason was: {}", risk.reason);
}

/// A route is as dangerous as its worst hex. Averaging would let one lethal step hide behind a
/// string of safe ones.
#[test]
fn a_route_takes_the_risk_of_its_worst_hex() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);
    let mover = unit_of(&report, "18642");

    // From the mountain at (7,53), stepping to the mountain at (7,51): the destination is known
    // only by name, so it cannot be assessed.
    let route = assess_route(&map, &ruleset(), &[at(7, 51)], mover);

    assert_eq!(route.level, RiskLevel::Medium);
    assert_eq!(route.hexes.len(), 1);
    assert_eq!(
        route.worst.as_ref().expect("a worst hex").coordinate,
        at(7, 51)
    );
}

#[test]
fn a_route_over_nothing_is_not_dangerous() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);

    let route = assess_route(&map, &ruleset(), &[], unit_of(&report, "18642"));

    assert_eq!(route.level, RiskLevel::Low);
    assert!(route.worst.is_none());
}

/// With hexes of differing danger, the route must take the worst rather than the first, the last
/// or the average. A single-hex route cannot tell those apart, so this one crosses two.
#[test]
fn the_worst_hex_sets_the_route_even_when_it_is_not_the_last() {
    let report = classified();
    let map = MapKnowledge::from_report(&report);
    let mover = unit_of(&report, "18642");

    // (7,53) holds 1438 foreign men against one - high. (7,51) is known only by name - medium.
    let route = assess_route(&map, &ruleset(), &[at(7, 53), at(7, 51)], mover);

    assert_eq!(route.level, RiskLevel::High);
    assert_eq!(
        route.worst.as_ref().expect("a worst hex").coordinate,
        at(7, 53),
        "the dangerous hex is the first one, not the last"
    );

    // The same two hexes the other way round give the same answer.
    let reversed = assess_route(&map, &ruleset(), &[at(7, 51), at(7, 53)], mover);
    assert_eq!(reversed.level, RiskLevel::High);
    assert_eq!(
        reversed.worst.as_ref().expect("a worst hex").coordinate,
        at(7, 53)
    );
}
