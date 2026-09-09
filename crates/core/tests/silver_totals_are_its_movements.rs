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
use atlantis_hud_core::orders::silver::{SilverChange, SilverChangeCause, UnitSilver};
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
            // The one arm that is in neither total, by decision: the column counts each unit on
            // its own, so borrowed silver is not this unit's income - it keeps the red month-end
            // figure the purchase left it with and the line says who covered it (`ah-3c2t.2`).
            .filter(|change| change.cause != SilverChangeCause::WasLent)
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

/// One hex with a market, and two own units: a buyer whose `TAKE ... ALL SILV` cannot be priced,
/// and the unit it takes from.
///
/// Built in the style of `crates/core/tests/silver_for_a_production.rs`'s `report` helper. The men
/// must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`.
fn doubted_market_report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "------------------------------------------------------------",
        "  Wages: $13.5 (Max: $633).",
        "  Wanted: none.",
        "  For Sale: 20 grain [GRAI] at $20.",
        "  Entertainment available: $85.",
        "  Products: none.",
        "",
        "* Buyers (900), Foo (1), 2 leaders [LEAD], 500 silver [SILV]. Weight: 20. \
         Capacity: 0/0/0/0. Skills: none.",
        "* Purse (902), Foo (1), 2 leaders [LEAD], 60 silver [SILV]. Weight: 20. \
         Capacity: 0/0/0/0. Skills: none.",
        "",
    ]
    .join("\n")
}

/// A doubted *income* silences the column's income and empties its change list - and its expense
/// is still a number, because `expense_doubt` stays `None`.
///
/// A characterisation test, and stated as such: nothing displayed changes across `ah-6m7b.4`. It
/// passes before the refactor and after it, and is expected to fail *during* it if a doubted
/// unit's market demand is left off the internal record - which is exactly what it is for.
#[test]
fn a_doubted_income_still_charges_what_the_purchase_asked_for_a_class_take() {
    let text = doubted_market_report();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\nunit 900\nTAKE FROM 902 ALL NORMAL\nBUY 2 grain\n");

    let review = review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default());
    let unit = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .expect("unit 900 is on the SILVER surface");

    assert_eq!(
        unit.income, None,
        "the take cannot be priced, so income is silenced"
    );
    assert_eq!(
        unit.expense,
        Some(40),
        "and the two grain are still 40 silver out"
    );
    assert!(
        unit.changes.is_empty(),
        "a doubted unit shows no change list at all (`ah-rgkk.4.4`) - this bead does not open that gate"
    );
}

/// `ah-42li`: the *other* unit in `doubted_market_report`. Buyers (900) takes all of Purse (902)'s
/// silver; `rules/sequenceofevents` settles Give orders before tax and before the market, so what
/// leaves Purse is the 60 the report shows it holding, and Purse ends the month with nothing.
///
/// Buyers' own figure stays doubted - that is `ah-sgn6`'s question and this bead does not touch it.
#[test]
fn the_unit_a_take_empties_says_where_its_silver_went() {
    let text = doubted_market_report();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\nunit 900\nTAKE FROM 902 ALL SILV\nBUY 2 grain\n");

    let review = review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default());
    let unit = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "902")
        .expect("unit 902 is on the SILVER surface");

    assert_eq!(unit.expense, Some(60), "all 60 leaves at the Give phase");
    let taken: Vec<_> = unit
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::WasTaken)
        .collect();
    assert_eq!(
        taken,
        vec![&SilverChange {
            amount: -60,
            cause: SilverChangeCause::WasTaken,
            // `ah-1x2h.3`: the taker's own line, recorded rather than dropped.
            line: Some(3),
            other: Some("Buyers (900)".to_string()),
        }],
        "one line, naming the taker, and carrying the taker's line - the order is in another unit's block (`ah-1x2h.3`)"
    );
    assert_eq!(unit.held, 60, "the report shows Purse holding 60");
    assert_eq!(
        unit.income,
        Some(27),
        "Purse writes no orders, so it works by default: 2 leaders at the hex's $13.5 wage"
    );
    assert_eq!(
        unit.at_month_end,
        Some(27),
        "the 60 it held is gone; what it earns of its own is untouched"
    );
}

/// `ah-sgn6`: the taker's own row, the other half of `ah-42li`'s fixture. Buyers takes all 60 of
/// Purse's silver in the Give phase, which `rules/sequenceofevents` settles before tax and before
/// the market - so the take is a number, and the tax, the purchase and the month end come back
/// with it.
#[test]
fn a_take_of_all_the_silver_is_counted_like_any_other_take() {
    let text = doubted_market_report();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\nunit 900\nTAKE FROM 902 ALL SILV\nBUY 2 grain\n");

    let review = review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default());
    let unit = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .expect("unit 900 is on the SILVER surface");

    let took: Vec<_> = unit
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Took)
        .collect();
    assert_eq!(
        took,
        vec![&SilverChange {
            amount: 60,
            cause: SilverChangeCause::Took,
            // `ah-1x2h.3`: the TAKE line, in this unit's own block.
            line: Some(3),
            other: Some("Purse (902)".to_string()),
        }],
        "one line, naming the source, and carrying the TAKE order's own line (`ah-1x2h.3`)"
    );
    assert_eq!(
        unit.expense,
        Some(40),
        "the two grain are still 40 silver out"
    );
    assert_eq!(
        unit.income,
        Some(87),
        "the 60 taken, plus 2 leaders working by default at the hex's $13.5 wage"
    );
    assert_eq!(
        unit.at_month_end,
        Some(547),
        "held 500, plus the 87 earned, less the 40 spent"
    );
}

/// `ah-sgn6`: the column and the ledger have to settle the take at one figure. The column's market
/// pass reads the ledger's own balance, and this is the first case where a live `ALL SILV` take
/// reaches it: `apply_transfers` resolves `ALL` against its own working holdings and
/// `semantics::transfer` against `known_balance_at(StatePhase::Give, ..)`, and nothing else
/// compares them.
#[test]
fn a_buy_all_after_taking_all_the_silver_spends_what_the_take_brought() {
    let text = doubted_market_report().replace(
        "2 leaders [LEAD], 500 silver [SILV]",
        "2 leaders [LEAD], 10 silver [SILV]",
    );
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\nunit 900\nTAKE FROM 902 ALL SILV\nBUY ALL grain\n");

    let review = review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default());
    let unit = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .expect("unit 900 is on the SILVER surface");

    assert_eq!(
        unit.expense,
        Some(60),
        "10 held plus 60 taken buys 3 grain at $20; wages arrive too late to pay for orders \
         (`ah-uwa3`)"
    );
}

/// `borrows` needs a negative relieved balance and `lendable` a positive one, so the two are
/// mutually exclusive by construction. This is what keeps them so (`ah-3c2t.2`).
#[test]
fn a_borrowing_unit_never_also_lends() {
    for (fixture, unit) in the_corpus() {
        let lends = unit
            .changes
            .iter()
            .any(|change| change.cause == SilverChangeCause::Lent);
        let borrows = unit
            .changes
            .iter()
            .any(|change| change.cause == SilverChangeCause::WasLent);

        assert!(
            !(lends && borrows),
            "{fixture} {}: a unit cannot both lend to the hex's purse and borrow from it",
            unit.unit_id
        );
    }
}
