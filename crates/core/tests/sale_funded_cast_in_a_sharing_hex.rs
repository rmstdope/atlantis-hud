//! The verifier's case for `ah-9n7l.2`, on the real report it was seen in: in the mountain hex
//! Aportheo of G3_F42_T40, Ivanhoe (683) holds 44 silver, casts Create Flaming Sword (600,
//! `data/CFSW`) and studies True Seeing (100), and sells 114 livestock it is given. Its six
//! silver-holding hex-mates stop sharing, so nobody can lend it the cast.
//!
//! `rules/sequenceofevents` casts the spells before the market opens, so the sale pays for the
//! study and never for the cast: the SILVER column shows 683 short $556, and the Problems list must
//! agree - mark the CAST and count the $556 in the hex's shortfall rather than netting the sale
//! against it.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

/// The report's own orders template, with the six silver-holding sharers set to `SHARE 0`, the
/// farmers' livestock given to 683 instead of sold, and - when `sell` - 683 selling it.
fn aportheo(sell: bool) -> TurnReview {
    let ruleset = ruleset();
    let report = atlantis_hud_fixtures::G3_F42_T40.text;
    let mut parsed = parse_report_full(report);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(report).expect("a template").text;

    let mut orders = String::new();
    let mut unit = String::new();
    for line in template.lines() {
        if unit == "3493" && line.trim() == "@SELL 114 LIVE" {
            orders.push_str("GIVE 683 114 LIVE\n");
            continue;
        }
        orders.push_str(line);
        orders.push('\n');
        if let Some(id) = line.strip_prefix("unit ") {
            unit = id.trim().to_string();
            if ["3493", "8048", "13303", "1159", "1161", "683"].contains(&unit.as_str()) {
                orders.push_str("SHARE 0\n");
            }
            if sell && unit == "683" {
                orders.push_str("SELL 114 LIVE\n");
            }
        }
    }
    assert!(
        orders.contains("GIVE 683 114 LIVE"),
        "the farmers' sale was found"
    );
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn hex_message(review: &TurnReview) -> String {
    let region = &review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "683")
        .expect("683 is forecast")
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
    found[0].to_string()
}

fn marked(review: &TurnReview, unit: &str) -> bool {
    review.findings.iter().any(|finding| {
        finding.code.as_str() == "part-of-hex-shortfall" && finding.unit_id.as_deref() == Some(unit)
    })
}

/// The baseline: without the sale the hex is short the cast, the study and the rest.
#[test]
fn without_the_sale_the_cast_is_part_of_the_hexs_shortfall() {
    let review = aportheo(false);
    assert!(marked(&review, "683"));
    assert!(
        hex_message(&review).starts_with("the units in this hex are short $1446 between them"),
        "{}",
        hex_message(&review)
    );
}

/// The sale pays for the study ($100) and not for the cast, so the hex is $100 better off and 683's
/// CAST is still marked, as the SILVER column says.
#[test]
fn the_sale_after_the_cast_still_leaves_the_cast_short_on_both_surfaces() {
    let review = aportheo(true);
    let ivanhoe = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "683")
        .expect("683 is forecast");
    // The refused cast is carried on its own rather than as a shortfall (`ah-rjz2`).
    assert_eq!(ivanhoe.short_for_orders, Some(0), "{ivanhoe:#?}");
    assert_eq!(ivanhoe.refused.len(), 1, "{ivanhoe:#?}");
    assert!(marked(&review, "683"), "{:#?}", review.findings);
    assert!(
        hex_message(&review).starts_with("the units in this hex are short $1346 between them"),
        "{}",
        hex_message(&review)
    );
}
