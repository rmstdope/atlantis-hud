//! A loan for a faction-mate's orders inside one hex names both parties, as the upkeep loan
//! beside it does (`ah-myko`, `docs/ui/ah-myko-order-loan-names-units.html`).
//!
//! `neworigins-3.0.0-g5-f21-t24`, the bead's repro: Drones (3732) in Lonthax (36,44) lends $3061
//! to its hex-mates' orders. `rules/share`: a sharing unit provides silver to "any other unit of
//! your faction ... in the same region" that "does not have enough to perform an action, such as
//! studying, buying or producing"; the engine drains the sharers in region order
//! (`unit.cpp`: `Unit::ConsumeShared`).

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn review() -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn row_of<'a>(review: &'a TurnReview, unit_id: &str) -> &'a UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("unit {unit_id} is forecast"))
}

/// Each `cause` line of `row`, as `(other, place, amount)`.
fn lines(row: &UnitSilver, cause: SilverChangeCause) -> Vec<(Option<String>, Option<String>, i64)> {
    row.changes
        .iter()
        .filter(|change| change.cause == cause)
        .map(|change| (change.other.clone(), change.place.clone(), change.amount))
        .collect()
}

fn in_hex(name: &str, amount: i64) -> (Option<String>, Option<String>, i64) {
    (Some(name.to_string()), None, amount)
}

/// The lender's side: one line per faction-mate whose orders 3732 paid for, in report order,
/// adding up to the $3061 the popup shows ("lent -3061").
#[test]
fn the_lenders_line_names_every_unit_it_paid_for() {
    let review = review();
    assert_eq!(
        lines(row_of(&review, "3732"), SilverChangeCause::Lent),
        vec![
            in_hex("Eight of One (1864)", -50),
            in_hex("Ten of Eight (5387)", -200),
            in_hex("Nine of Eight (5982)", -50),
            in_hex("Drones (7184)", -100),
            in_hex("Drones (7875)", -150),
            in_hex("Drones (7876)", -100),
            in_hex("Drones (8573)", -600),
            in_hex("Drones (9498)", -1000),
            in_hex("Drones (3364)", -50),
            in_hex("Scout (3730)", -50),
            in_hex("Unit (11850)", -100),
            in_hex("Six of Seven (1296)", -11),
            in_hex("Drones (7880)", -100),
            in_hex("Drones (5983)", -500),
        ]
    );
}

/// The borrower's side: the unit 3732 paid $1000 for names it.
#[test]
fn the_borrowers_line_names_the_unit_that_paid() {
    let review = review();
    assert_eq!(
        lines(row_of(&review, "9498"), SilverChangeCause::WasLent),
        vec![in_hex("Drones (3732)", 1000)]
    );
}

/// The passenger's loan across a sailing keeps exactly its `ah-kjq5` wording: 9508 at ocean
/// (38,44) names the passenger and the hex it sails from, and 10594 names 9508 and where its
/// fleet lands.
#[test]
fn a_loan_across_a_sailing_is_unchanged() {
    let review = review();
    assert_eq!(
        lines(row_of(&review, "9508"), SilverChangeCause::Lent),
        vec![(
            Some("Drones (10594)".to_string()),
            Some("Lonthax (36,44)".to_string()),
            -200
        )]
    );
    assert_eq!(
        lines(row_of(&review, "10594"), SilverChangeCause::WasLent),
        vec![(
            Some("Drones (9508)".to_string()),
            Some("ocean (38,44)".to_string()),
            200
        )]
    );
}

/// Across this report, every loan line names its other party, and each one a lender books is
/// mirrored by its borrower's, the same amount the other way: the two sides of one loan - in one
/// hex, or across a sailing. Not a property of every report: a sharer arriving from another hex
/// that pays an arriving passenger's STUDY names nobody on its own row (out of `ah-myko`'s scope;
/// the follow-up bead names it). This report has no such loan.
#[test]
fn every_loan_is_named_on_both_sides() {
    let review = review();
    let mut lent: Vec<(String, String, i64)> = Vec::new();
    let mut was_lent: Vec<(String, String, i64)> = Vec::new();
    for row in &review.silver {
        for change in &row.changes {
            let other = || {
                change.other.clone().unwrap_or_else(|| {
                    panic!("unit {} books an unnamed {:?}", row.unit_id, change.cause)
                })
            };
            match change.cause {
                SilverChangeCause::Lent => {
                    lent.push((row.unit_id.clone(), other(), -change.amount))
                }
                SilverChangeCause::WasLent => {
                    was_lent.push((other(), row.unit_id.clone(), change.amount))
                }
                _ => {}
            }
        }
    }
    assert!(!lent.is_empty(), "the report lends inside a hex");
    // A line names `<name> (<id>)`; compare by the id in brackets.
    let id = |name: &str| {
        name.rsplit_once('(')
            .and_then(|(_, id)| id.strip_suffix(')'))
            .unwrap_or(name)
            .to_string()
    };
    let normalise = |loans: Vec<(String, String, i64)>, lender_named: bool| {
        let mut loans: Vec<(String, String, i64)> = loans
            .into_iter()
            .map(|(lender, borrower, amount)| {
                if lender_named {
                    (id(&lender), borrower, amount)
                } else {
                    (lender, id(&borrower), amount)
                }
            })
            .collect();
        loans.sort();
        loans
    };
    assert_eq!(normalise(lent, false), normalise(was_lent, true));
}
