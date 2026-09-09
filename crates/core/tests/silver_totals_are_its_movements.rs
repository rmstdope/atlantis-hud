//! The SILVER column's totals, held to the movement list they are supposed to be built from.
//!
//! [`SilverChange`]'s own doc has claimed since it was written that "every term either total is
//! built from appears here exactly once, so a consumer can say where the money came from and where
//! it went without deriving anything of its own." Nothing enforced that, and it was false: a
//! `sharing` unit whose silver the hex's purse drew out to pay a faction-mate's orders was charged
//! to `expense` with no entry in its list at all (`ah-6m7b.4`).
//!
//! This file is what makes the claim true rather than hoped for. The corpus test is the one to keep
//! for ever: it is what stops a future arm adding to a total and forgetting the record.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// Every own unit of every committed fixture, with its column entry.
///
/// The walk is `compare_the_corpus`'s, from `crates/core/tests/silver_agrees_with_the_warning.rs`,
/// copied because that function is private to its own test binary and is not reachable across
/// binaries. A fixture without an orders template is run with an empty orders document rather than
/// skipped, for the same reason it is there: a unit with no orders still holds silver.
fn the_corpus() -> Vec<(&'static str, UnitSilver)> {
    let ruleset = ruleset();
    let mut all = Vec::new();

    for report in atlantis_hud_fixtures::ALL {
        let mut parsed = parse_report_full(report.text);
        classify_units(&mut parsed, &ruleset);
        let orders = extract_orders_template(report.text)
            .map(|template| template.text)
            .unwrap_or_default();

        let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
        for silver in review.silver {
            all.push((report.name, silver));
        }
    }

    all
}

#[test]
fn every_unit_in_the_corpus_totals_what_its_changes_say() {
    for (fixture, unit) in the_corpus() {
        // A doubted unit's list is emptied on the way out (`ah-rgkk.4.4`, `silver.rs:2638`),
        // deliberately: "a partial ledger under a figure that is not a number would invite a
        // consumer to add the entries up and disagree with the column beside it." Its totals
        // therefore cannot be its movements summed, and it is exempt.
        //
        // `ah-6m7b.4`'s plan asserted no corpus unit is doubted. That is false: Ivanhoe (683) of
        // `G3_F42_T82` casts phantasmal entertainment for 1200 with `expense = None`, so its
        // `income` stands against an empty list. The guard is the doubt gate, not that unit.
        if unit.doubt.is_some() {
            assert!(
                unit.changes.is_empty(),
                "{fixture} {}: a doubted unit shows no change list at all",
                unit.unit_id
            );
            continue;
        }

        let income_moved: i64 = unit
            .changes
            .iter()
            .filter(|change| change.amount > 0)
            .map(|change| change.amount)
            .sum();
        let expense_moved: i64 = unit
            .changes
            .iter()
            .filter(|change| change.amount < 0)
            .map(|change| -change.amount)
            .sum();

        if let Some(income) = unit.income {
            assert_eq!(
                income, income_moved,
                "{fixture} {}: income is its movements summed",
                unit.unit_id
            );
        }
        if let Some(expense) = unit.expense {
            assert_eq!(
                expense, expense_moved,
                "{fixture} {}: expense is its movements summed",
                unit.unit_id
            );
        }
    }
}

#[test]
fn a_sharing_unit_says_where_its_loan_went() {
    let (_, lender) = the_corpus()
        .into_iter()
        .find(|(fixture, unit)| *fixture == "G3_F42_T40" && unit.unit_id == "3493")
        .expect("unit 3493 of G3_F42_T40 is a `sharing` unit that lends to the hex's purse");

    let lent: Vec<_> = lender
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Lent)
        .collect();

    assert_eq!(lent.len(), 1, "one loan, one line");
    assert_eq!(lent[0].amount, -90, "signed out of the unit");
    assert_eq!(lent[0].line, None, "the SHARE flag lent it, not an order");
    assert_eq!(lent[0].other, None, "the hex's purse is not a unit");
}
