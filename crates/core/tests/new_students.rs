//! `ah-x7s3`. How many new quartermasters, mages and apprentices this month's orders make, for the
//! faction view's Allowances rows.
//!
//! Rules each count rests on:
//! - `rules/magic`: "A character enters the world of magic in Atlantis by beginning study on one of
//!   the Foundation magic skills".
//! - `rules/magic_foundations`: "The three Foundation skills are called force, pattern, and spirit".
//! - `rules/magic_apprentices`: "Apprentices may be created by having a unit study manipulation".
//! - `data/QUAM`: quartermaster; `data/MANI`: "A unit with this skill becomes an apprentice".

use atlantis_hud_core::orders::new_students::NewStudents;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::validate_turn;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// A report header, then the given region blocks.
fn report(hexes: &[String]) -> String {
    let mut lines: Vec<String> = ["Atlantis Report For:", "Foo (1)", "February, Year 1", ""]
        .iter()
        .map(ToString::to_string)
        .collect();
    lines.extend(hexes.iter().cloned());
    lines.join("\n")
}

/// One plain hex at `(1,1)` with the given unit lines.
fn hex(units: &[&str]) -> String {
    let mut lines = vec![
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $500.".to_string(),
        "------------------------------------------------------------".to_string(),
        "  Wages: $13.5 (Max: $633).".to_string(),
        "  Wanted: none.".to_string(),
        "  For Sale: 100 grain [GRAI] at $1.".to_string(),
        "  Entertainment available: $0.".to_string(),
        "  Products: none.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (9,9) in Nowhere.".to_string(),
        String::new(),
    ];
    lines.extend(units.iter().map(ToString::to_string));
    lines.push(String::new());
    lines.join("\n")
}

fn review_with(text: &str, script: &str, with_ruleset: bool) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    review_turn(
        &parsed,
        &format!("{template}\n{script}"),
        with_ruleset.then_some(&ruleset),
        CheckOptions::default(),
    )
}

fn review_of(text: &str, script: &str) -> TurnReview {
    review_with(text, script, true)
}

fn unit(id: u32, skills: &str) -> String {
    format!(
        "* Student ({id}), Foo (1), behind, 1 orc [ORC]. Weight: 10. Capacity: 0/0/15/0. \
         Skills: {skills}."
    )
}

fn one_unit_review(skills: &str, script: &str) -> TurnReview {
    let line = unit(900, skills);
    review_of(&report(&[hex(&[&line])]), script)
}

const ZERO: NewStudents = NewStudents {
    quartermasters: 0,
    mages: 0,
    apprentices: 0,
};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/../../tests/fixtures/reports/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("fixture report")
}

#[test]
fn a_unit_first_studying_force_is_one_new_mage() {
    let review = one_unit_review("combat [COMB] 1 (30)", "unit 900\nSTUDY FORC\n");
    assert_eq!(review.students, NewStudents { mages: 1, ..ZERO });
}

#[test]
fn pattern_and_spirit_start_a_mage_too() {
    let a = unit(900, "combat [COMB] 1 (30)");
    let b = unit(901, "combat [COMB] 1 (30)");
    let review = review_of(
        &report(&[hex(&[&a, &b])]),
        "unit 900\nSTUDY pattern\nunit 901\nSTUDY SPIR\n",
    );
    assert_eq!(review.students, NewStudents { mages: 2, ..ZERO });
}

#[test]
fn a_unit_first_studying_quartermaster_is_one_new_quartermaster() {
    let review = one_unit_review("combat [COMB] 1 (30)", "unit 900\nSTUDY quartermaster\n");
    assert_eq!(
        review.students,
        NewStudents {
            quartermasters: 1,
            ..ZERO
        }
    );
}

#[test]
fn a_unit_first_studying_manipulation_is_one_new_apprentice() {
    let review = one_unit_review("combat [COMB] 1 (30)", "unit 900\nSTUDY MANI\n");
    assert_eq!(
        review.students,
        NewStudents {
            apprentices: 1,
            ..ZERO
        }
    );
}

#[test]
fn a_unit_already_holding_the_skill_adds_nothing() {
    let review = one_unit_review("force [FORC] 1 (30)", "unit 900\nSTUDY FORC\n");
    assert_eq!(review.students, ZERO);
}

#[test]
fn a_mage_starting_another_foundation_is_not_a_new_mage() {
    let review = one_unit_review("force [FORC] 1 (30)", "unit 900\nSTUDY PATT\n");
    assert_eq!(review.students, ZERO);
}

#[test]
fn quarrying_is_not_quartermaster() {
    let review = one_unit_review("combat [COMB] 1 (30)", "unit 900\nSTUDY QUAR\n");
    assert_eq!(review.students, ZERO);
}

/// Two month-long orders: the last one is the month's winner (`ah-728m.2.1`), so a STUDY FORC that a
/// later STUDY COMB replaces never runs and makes no mage.
#[test]
fn a_study_replaced_by_a_later_one_does_not_count() {
    let review = one_unit_review("combat [COMB] 1 (30)", "unit 900\nSTUDY FORC\nSTUDY COMB\n");
    assert_eq!(review.students, ZERO);
}

#[test]
fn a_foreign_unit_is_not_counted() {
    let own = unit(900, "combat [COMB] 1 (30)");
    let foreign = "- Someone (500), Bar (2), 1 orc [ORC]. Skills: combat [COMB] 1 (30).";
    let review = review_of(&report(&[hex(&[&own, foreign])]), "unit 500\nSTUDY FORC\n");
    assert_eq!(review.students, ZERO);
}

#[test]
fn without_a_ruleset_nothing_counts() {
    let line = unit(900, "combat [COMB] 1 (30)");
    let review = review_with(&report(&[hex(&[&line])]), "unit 900\nSTUDY FORC\n", false);
    assert_eq!(review.students, ZERO);
}

#[test]
fn the_example_report_with_no_orders_counts_nothing() {
    let text = fixture("neworigins-3.0.0-g7-f62-t20.rep");
    let review = review_of(&text, "");
    assert_eq!(review.students, ZERO);
    assert!(review.production.regions.is_empty());
}

#[test]
fn turn_71s_foundation_students_already_hold_one() {
    let text = fixture("neworigins-3.0.0-g7-f95-t71.rep");
    let review = review_of(&text, "");
    assert_eq!(review.students.mages, 0);
}

#[test]
fn validate_turn_carries_new_students() {
    let ruleset = ruleset();
    let line = unit(900, "combat [COMB] 1 (30)");
    let text = report(&[hex(&[&line])]);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    let result = validate_turn(
        "unit 900\nSTUDY FORC\n",
        Some(&ruleset),
        Some(&parsed),
        CheckOptions::default(),
    );
    assert_eq!(result.students.mages, 1);
}
