//! A `BUY` the hex's `SHARE` purse paid in full is not what its buyer is short on (`ah-4j5f`).
//!
//! `rules/sequenceofevents` runs Market orders (BUY) before Month long orders (STUDY), and the
//! engine sizes a `BUY` against `GetSharedMoney()` (`runorders.cpp`: `GetBuyAmount`), so a purchase
//! the other sharers can cover is bought in full and the purse they lent it is gone by the time
//! the buyer's `STUDY` asks for its fee (`monthorders.cpp`: `Do1StudyOrder`, `cost >
//! GetSharedMoney()`). What the unit falls short on is then the study, never the purchase.
//!
//! Found in exploratory testing on the committed turn 42: Reginald Front-de-Boeuf (1161) holds
//! $5305 in `mountain (36,4)` and buys 51 chocolate at $126 ($6426). With City Guards (13303) and
//! Ivanhoe (683) not sharing, no livestock sold and no Phantasmal Entertainment cast, the purse
//! that is left - Brian de Bois-Guilbert (1159) and Seal (8048) - pays the $1121 the purchase
//! needs, and nothing is left for the $100 study. The hover read "100 short of what its purchase
//! costs", because the column named the first spending order in the block.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{SilverChangeCause, SilverSpender, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The report's own orders template, with `edits` applied in turn - each must find its text.
fn reginald_under(edits: &[(&str, &str)]) -> UnitSilver {
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let mut orders = extract_orders_template(text)
        .expect("the committed turn 42 carries an orders template")
        .text;
    for (from, to) in edits {
        assert!(orders.contains(from), "the template still holds {from:?}");
        orders = orders.replacen(from, to, 1);
    }
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset());
    review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default())
        .silver
        .into_iter()
        .find(|silver| silver.unit_id == "1161")
        .expect("Reginald (1161) has a SILVER row")
}

/// Reginald buys 51 chocolate in place of his Phantasmal Entertainment cast, and the purse's two
/// biggest lenders and the hex's one seller are taken out of it.
const THIN_PURSE: &[(&str, &str)] = &[
    ("@CAST PHEN\n@STUDY WOLF", "BUY 51 CHOC\n@STUDY WOLF"),
    ("\nunit 13303\n", "\nunit 13303\nSHARE 0\n"),
    ("\nunit 683\n", "\nunit 683\nSHARE 0\n"),
    ("@SELL 114 LIVE", ""),
];

#[test]
fn a_purchase_the_purse_paid_in_full_is_not_what_the_buyer_is_short_on() {
    let reginald = reginald_under(THIN_PURSE);

    let bought: i64 = reginald
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Bought)
        .map(|change| change.amount)
        .sum();
    assert_eq!(
        bought, -6426,
        "the purse covers the purchase, so all 51 chocolate are bought at $126: {reginald:?}"
    );
    assert_eq!(
        reginald.short_for_orders,
        Some(100),
        "the $100 study is what nothing is left for: {reginald:?}"
    );
    assert_eq!(
        reginald.short_on,
        Some(SilverSpender::Study),
        "the study is what falls short, not the purchase the purse paid: {reginald:?}"
    );
}

/// The purchase is still named where it is the order the purse cannot pay: a `BUY 60` the hex
/// cannot fund in full is cut, and that cut is the shortfall (`ah-omn7`).
#[test]
fn a_purchase_the_purse_could_not_pay_in_full_is_still_what_the_buyer_is_short_on() {
    let mut edits = THIN_PURSE.to_vec();
    edits[0] = ("@CAST PHEN\n@STUDY WOLF", "BUY 88 CHOC\n@STUDY WOLF");
    let reginald = reginald_under(&edits);

    assert!(
        reginald.short_for_orders.is_some_and(|short| short > 0),
        "88 chocolate cost $11088, more than Reginald and the purse hold: {reginald:?}"
    );
    assert_eq!(reginald.short_on, Some(SilverSpender::Buy), "{reginald:?}");
}
