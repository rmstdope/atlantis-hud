//! The case `ah-j5s1` was filed from: `desert (41,35)` of Arcanum faction 5's turn 84, the report's
//! own orders template with 4008's orders replaced by `GIVE 4840 9999999 SILV` and 4686's cleared.
//! Every unit of that hex shares (`rules/share`), so the hex's silver is judged as one pool.
//!
//! The hex's silver sentence read "they can have $-8911669 and their orders and upkeep spend
//! $-6660": both figures negative. The navigator's decision: both figures are non-negative amounts
//! a player can check, and the shortfall is their difference.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;

fn review(ruleset: &atlantis_hud_core::movement::rules::Ruleset) -> TurnReview {
    let report = atlantis_hud_fixtures::NEWAGE_ARCANUM_F5_T84.text;
    let template = extract_orders_template(report).expect("a template").text;

    let mut orders = String::new();
    let mut unit = String::new();
    for line in template.lines() {
        if let Some(id) = line.strip_prefix("unit ") {
            unit = id.trim().to_string();
            orders.push_str(line);
            orders.push('\n');
            if unit == "4008" {
                orders.push_str("GIVE 4840 9999999 SILV\n");
            }
            continue;
        }
        if unit == "4008" || unit == "4686" {
            continue;
        }
        orders.push_str(line);
        orders.push('\n');
    }
    assert!(orders.contains("unit 4686"), "4686 is in the template");
    review_orders(ruleset, &orders)
}

fn review_orders(
    ruleset: &atlantis_hud_core::movement::rules::Ruleset,
    orders: &str,
) -> TurnReview {
    let report = atlantis_hud_fixtures::NEWAGE_ARCANUM_F5_T84.text;
    let mut parsed = parse_report_full(report);
    classify_units(&mut parsed, ruleset);
    review_turn(&parsed, orders, Some(ruleset), CheckOptions::default())
}

/// `(short, can have, spend)` from the hex's not-enough-silver sentence.
fn figures(review: &TurnReview) -> (i64, i64, i64) {
    let region = &review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "4008")
        .expect("4008 is forecast")
        .region_id;
    let found: Vec<&str> = review
        .findings
        .iter()
        .filter(|finding| {
            &finding.region_id == region
                && finding.unit_id.is_none()
                && finding.code.as_str() == "not-enough-silver"
        })
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(found.len(), 1, "{found:?}");
    let message = found[0];
    let amount = |after: &str| -> i64 {
        let rest =
            &message[message.find(after).unwrap_or_else(|| panic!("{message}")) + after.len()..];
        let digits: String = rest
            .chars()
            .take_while(|c| *c == '-' || c.is_ascii_digit())
            .collect();
        digits.parse().unwrap_or_else(|_| panic!("{message}"))
    };
    (amount("short $"), amount("can have $"), amount("spend $"))
}

fn assert_readable(review: &TurnReview) {
    let (short, held, spend) = figures(review);
    assert!(short > 0, "short ${short}");
    assert!(held >= 0, "can have ${held}");
    assert!(spend >= 0, "spend ${spend}");
    assert_eq!(spend - held, short, "the shortfall is the difference");
}

#[test]
fn a_giver_asking_far_beyond_the_pool_reads_non_negative_figures() {
    assert_readable(&review(&common::ruleset()));
}

#[test]
fn and_under_the_trident_ruleset_too() {
    assert_readable(&review(&common::trident_ruleset()));
}

/// The same gift as the hex's only order: no standing order of anyone else's in the sentence.
#[test]
fn the_gift_alone_reads_non_negative_figures() {
    assert_readable(&review_orders(
        &common::ruleset(),
        "unit 4008\nGIVE 4840 9999999 SILV\n",
    ));
}
