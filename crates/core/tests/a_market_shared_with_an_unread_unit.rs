//! What a unit earns selling into a hex where an own hex-mate's report line was cut short
//! (`ah-0n2k.2`), read end to end from a parsed report and a real settlement.
//!
//! `rules/sell`: *"If more of the item are on sale (by all the units in the region) than are wanted
//! by the region, the number sold per unit will be split up in proportion to the number each unit
//! tried to sell."* A unit whose line was cut short reached the model with no items, so its claim
//! on the line reads `0` and the split divided the line among too few sellers. The figure is kept
//! and relabelled as the most it can be.
//!
//! `rules/sequenceofevents` puts *SELL orders* in the Market phase, before the month-long orders,
//! so the overstatement is in-time income - which is why `income_in_time_at_most` is the flag.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverDoubt, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex, an optional market line, and whatever own units the caller names.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`.
fn report(region: &str, market: &[&str], units: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        region.to_string(),
    ];
    lines.extend(market.iter().map(|line| format!("  {line}")));
    lines.extend([
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
    ]);
    lines.extend(units.iter().map(|unit| (*unit).to_string()));
    lines.push(String::new());
    lines.join("\n")
}

/// The whole review for one order script, so a test can read the column and the findings from one
/// pass - they are computed together and must agree.
fn review_of(text: &str, script: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    review_turn(
        &parsed,
        &format!("{template}\n{script}"),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

fn row_of(review: &TurnReview, unit_id: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the column has a row for unit {unit_id}"))
        .clone()
}

/// A quiet region: nothing to tax, nothing to pillage, no wages worth having.
const QUIET: &str = "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.";

/// Ten furs wanted and nothing for sale, so the only pool in play is the one this bead is about.
const WANTS_FURS: &[&str] = &["Wanted: 10 furs [FUR] at $24.", "For Sale: none."];

/// The seller, read in full, and a hex-mate whose line ends at a comma - which is all a cut-short
/// line is (`report/unit.rs`, `line_was_cut_short`).
const SELLER: &str =
    "* Seller (900), Foo (1), 10 orcs [ORC], 10 furs [FUR]. Weight: 130. Capacity: 0/0/150/0.";
const CUT_SHORT: &str = "* Cut short (901), Foo (1), avoiding, behind,";
/// The same unit with its line intact, for the control.
const READ_IN_FULL: &str =
    "* Cut short (901), Foo (1), 10 orcs [ORC], 10 furs [FUR]. Weight: 130. Capacity: 0/0/150/0.";

/// The bare `SAIL` is what spends the seller's month: without it the unit is set to work by
/// default and `ah-0n2k.1` bounds its late half too, which is a different statement from this one.
const BOTH_SELL: &str = "unit 900\nSAIL\nSELL ALL FUR\nunit 901\nSELL ALL FUR\n";
const ONLY_900_SELLS: &str = "unit 900\nSAIL\nSELL ALL FUR\n";

#[test]
fn a_sellers_share_is_a_ceiling_when_an_unread_hex_mate_was_told_to_sell() {
    let review = review_of(&report(QUIET, WANTS_FURS, &[SELLER, CUT_SHORT]), BOTH_SELL);
    // First, and not last: without this the assertions below are vacuous.
    assert_eq!(
        row_of(&review, "901").doubt,
        Some(SilverDoubt::SilverNeverRead)
    );
    let seller = row_of(&review, "900");
    assert_eq!(
        seller.income,
        Some(240),
        "all ten furs at $24 - 901 claimed nothing"
    );
    assert_eq!(seller.doubt, None, "a bound is not a doubt");
    assert!(seller.income_in_time_at_most);
    assert!(!seller.late_income_at_most);
}

#[test]
fn a_hex_mate_read_in_full_splits_the_line_and_bounds_nothing() {
    let review = review_of(
        &report(QUIET, WANTS_FURS, &[SELLER, READ_IN_FULL]),
        BOTH_SELL,
    );
    let seller = row_of(&review, "900");
    assert_eq!(seller.income, Some(120), "five furs each, at $24");
    assert!(!seller.income_in_time_at_most);
    assert!(!seller.late_income_at_most);
    let mate = row_of(&review, "901");
    assert!(!mate.income_in_time_at_most);
    assert!(!mate.late_income_at_most);
}

#[test]
fn an_unread_hex_mate_with_no_sell_order_bounds_nothing() {
    let review = review_of(
        &report(QUIET, WANTS_FURS, &[SELLER, CUT_SHORT]),
        ONLY_900_SELLS,
    );
    let seller = row_of(&review, "900");
    assert_eq!(seller.income, Some(240));
    assert!(
        !seller.income_in_time_at_most,
        "901 cannot sell without an order, so the figure is exact"
    );
}
