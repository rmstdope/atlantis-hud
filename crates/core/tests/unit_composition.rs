//! Acceptance tests for telling a unit's men from its equipment.
//!
//! A report writes a unit's people and its kit as one undifferentiated list, so `50 gnolls [GNOL],
//! 49 orcs [ORC], 58 mithril swords [MSWO]` is only separable with an item reference. Until the
//! catalogue was scraped there was none, and the parser fell back to counting the leading group -
//! which is right for the common case and quietly wrong whenever a unit holds two races.
//!
//! The units quoted here are from the committed turn 71 report, and their totals were read out of
//! it by hand.

use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::report::{classify_units, parse_report_full, ParsedReport};

const TURN_71: &str = include_str!("../../../tests/fixtures/reports/neworigins-3.0.0-f95-t71.rep");
const RULESET: &str = include_str!("../../../config/ruleset.json");

fn ruleset() -> Ruleset {
    Ruleset::from_json(RULESET).expect("the committed ruleset should load")
}

/// A ruleset that is still perfectly valid but whose catalogue has drifted away from the report.
///
/// Built by keeping one race and dropping the rest, which is what a ruleset scraped from a
/// different game - or from the same game after a content change - looks like from here.
fn thin_ruleset() -> String {
    let full: serde_json::Value = serde_json::from_str(RULESET).expect("the ruleset is json");
    let mut thin = full.clone();
    let leader = full["items"]["LEAD"].clone();
    thin["items"] = serde_json::json!({ "LEAD": leader });
    thin.to_string()
}

fn unit_of<'a>(
    report: &'a ParsedReport,
    unit_id: &str,
) -> &'a atlantis_hud_core::report::model::ReportUnit {
    report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit")
}

/// The defect, stated as a test: two races in one unit and only the first is counted.
#[test]
fn without_a_catalogue_a_two_race_unit_is_undercounted_and_says_so() {
    let report = parse_report_full(TURN_71);

    // "- Crax's Inf (15807), Greywolf (33), 50 gnolls [GNOL], 49 orcs [ORC], 58 mithril swords..."
    let unit = unit_of(&report, "15807");
    assert_eq!(unit.men, 50, "the leading group is all the parser can see");
    assert!(
        unit.men_estimated,
        "a figure the parser guessed at must not present itself as counted"
    );
    assert!(unit.men_by_race.is_empty());
}

#[test]
fn the_catalogue_counts_every_race_in_a_unit() {
    let mut report = parse_report_full(TURN_71);
    classify_units(&mut report, &ruleset());

    let unit = unit_of(&report, "15807");
    assert_eq!(unit.men, 99, "50 gnolls and 49 orcs");
    assert!(!unit.men_estimated);

    let races: Vec<(&str, i64)> = unit
        .men_by_race
        .iter()
        .map(|race| (race.tag.as_str(), race.amount))
        .collect();
    assert_eq!(races, vec![("GNOL", 50), ("ORC", 49)]);
}

#[test]
fn a_larger_two_race_unit_counts_too() {
    let mut report = parse_report_full(TURN_71);
    classify_units(&mut report, &ruleset());

    // "- GruntA (16607), Archon Dominion (53), 302 drow elves [DRLF], 95 gnolls [GNOL], ..."
    let unit = unit_of(&report, "16607");
    assert_eq!(unit.men, 397);
}

#[test]
fn equipment_is_never_counted_as_men() {
    let mut report = parse_report_full(TURN_71);
    classify_units(&mut report, &ruleset());

    // The same unit carries 58 mithril swords, 99 mithril armor and 21 mithril shields. Counting
    // the lot would give a unit of 99 men an army of 277.
    let unit = unit_of(&report, "15807");
    assert_eq!(unit.men, 99);
    assert!(unit
        .men_by_race
        .iter()
        .all(|race| race.tag != "MSWO" && race.tag != "MARM" && race.tag != "MSHD"));
}

/// A centaur is both a race and a mount. Classified as a mount it would vanish from every
/// headcount, which is the single case the catalogue exists to get right.
#[test]
fn a_centaur_counts_as_a_man() {
    let mut report = parse_report_full(TURN_71);
    classify_units(&mut report, &ruleset());

    // "- Lumber Spare (7296), Greywolf (33), avoiding, behind, centaur [CTAU], axe [AXE]."
    let unit = unit_of(&report, "7296");
    assert_eq!(unit.men, 1);
    assert_eq!(
        unit.men_by_race
            .iter()
            .map(|race| race.tag.as_str())
            .collect::<Vec<_>>(),
        vec!["CTAU"]
    );

    // "- AactCRO (15654), Archon Dominion (53), avoiding, behind, centaur [CTAU], 2 winged horses
    //    [WING], 4 horses [HORS]." - the mounts are not men, the centaur is.
    let mounted = unit_of(&report, "15654");
    assert_eq!(mounted.men, 1);
}

/// Silver is the one item the old heuristic special-cased, and it must stay out of a headcount.
#[test]
fn silver_is_not_a_man() {
    let mut report = parse_report_full(TURN_71);
    classify_units(&mut report, &ruleset());

    // "* Drones (14451), ... 50 lizardmen [LIZA], 7500 silver [SILV]. Weight: 500."
    let unit = unit_of(&report, "14451");
    assert_eq!(unit.men, 50);
}

/// The catalogue and the report come from the same game, so every item the report names should be
/// one the catalogue knows. An unrecognised tag means they have drifted apart.
#[test]
fn the_catalogue_recognises_every_item_the_report_names() {
    let mut report = parse_report_full(TURN_71);
    let classification = classify_units(&mut report, &ruleset());

    assert_eq!(
        classification.unknown_tags,
        Vec::<String>::new(),
        "every item tag in the report should be in the catalogue"
    );
}

/// The failure that matters most: a ruleset that has drifted from the report.
///
/// The catalogue is scraped from a live page, so drift is the expected way this goes wrong, not an
/// exotic one. Counting only the tags a stale catalogue happens to recognise and then calling the
/// result exact is worse than not classifying at all - it turns "I am not sure" into a confident
/// wrong number, which is the one thing this design exists to prevent.
#[test]
fn a_unit_the_catalogue_only_half_recognises_stays_an_estimate() {
    let thin = Ruleset::from_json(&thin_ruleset()).expect("a one-item catalogue is still valid");

    let mut report = parse_report_full(TURN_71);
    let before = unit_of(&report, "15807").men;
    let classification = classify_units(&mut report, &thin);

    let unit = unit_of(&report, "15807");
    assert!(
        unit.men_estimated,
        "a unit holding tags the catalogue does not know must not report an exact count"
    );
    assert_eq!(
        unit.men, before,
        "the parser's estimate is better than a count of the few tags that happened to match"
    );
    assert!(!classification.unknown_tags.is_empty());
}

/// Re-running with a real catalogue after a drifted one must recover, not stay poisoned.
#[test]
fn classifying_again_with_a_full_catalogue_recovers() {
    let mut report = parse_report_full(TURN_71);
    classify_units(
        &mut report,
        &Ruleset::from_json(&thin_ruleset()).expect("loads"),
    );
    classify_units(&mut report, &ruleset());

    let unit = unit_of(&report, "15807");
    assert_eq!(unit.men, 99);
    assert!(!unit.men_estimated);
}

/// Classification reads the item list and never rewrites it, so running twice says the same thing.
#[test]
fn classifying_twice_changes_nothing() {
    let mut once = parse_report_full(TURN_71);
    classify_units(&mut once, &ruleset());

    let mut twice = parse_report_full(TURN_71);
    classify_units(&mut twice, &ruleset());
    classify_units(&mut twice, &ruleset());

    assert_eq!(unit_of(&once, "15807").men, unit_of(&twice, "15807").men);
    assert_eq!(
        unit_of(&once, "15807").men_by_race,
        unit_of(&twice, "15807").men_by_race
    );
}

/// A unit with nothing at all holds nobody, and that is a count rather than a guess.
#[test]
fn a_unit_with_no_items_holds_nobody_and_that_is_certain() {
    let mut report = parse_report_full(
        "Foo (1) Report\n\
         mountain (1,1) in Nowhere, 100 peasants (orcs), $50.\n\
         \n\
         * Empty (901), Foo (1).\n",
    );
    classify_units(&mut report, &ruleset());

    let unit = unit_of(&report, "901");
    assert_eq!(unit.men, 0);
    assert!(!unit.men_estimated, "nothing to be unsure about");
}

/// Region sightings are persisted as JSON of this very model, and the persistence contract says
/// changes must "be additive and preserve upgradeability from prior versions". A payload written
/// before these fields existed came from a build that never classified anything, so the honest
/// default is the estimate - and it must load rather than fail.
#[test]
fn a_payload_written_before_these_fields_existed_still_loads() {
    let stored = r#"{
        "unitId": "900", "name": "Scouts", "regionId": "1:1,1",
        "factionId": "1", "factionName": "Foo", "own": true, "onGuard": false,
        "flags": [], "items": [], "skills": [], "men": 3,
        "weight": null, "capacity": null, "structureId": null
    }"#;

    let unit: atlantis_hud_core::report::model::ReportUnit =
        serde_json::from_str(stored).expect("an older payload should still load");

    assert_eq!(unit.men, 3);
    assert!(
        unit.men_estimated,
        "a payload from a build that could not classify must not claim an exact count"
    );
    assert!(unit.men_by_race.is_empty());
}

/// A tag the catalogue has never heard of is equipment, not a person, and it is reported rather
/// than passed over - guessing that an unknown thing is a man would inflate a headcount.
#[test]
fn an_unknown_tag_is_equipment_and_is_reported() {
    let mut report = parse_report_full(
        "Foo (1) Report\n\
         mountain (1,1) in Nowhere, 100 peasants (orcs), $50.\n\
         \n\
         * Scouts (900), Foo (1), 3 orcs [ORC], 2 widgets [WDGT].\n",
    );
    let classification = classify_units(&mut report, &ruleset());

    let unit = unit_of(&report, "900");
    assert_eq!(unit.men, 3, "only the orcs are people");
    assert_eq!(classification.unknown_tags, vec!["WDGT".to_string()]);
}
