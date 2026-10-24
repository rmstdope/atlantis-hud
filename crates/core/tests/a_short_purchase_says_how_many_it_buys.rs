//! A unit short of what its `BUY` costs carries what that order asked for and what it actually
//! buys, so the SILVER hover can say "8650 short: it buys 9 of the 50 gems ordered." (`ah-ottr`).
//!
//! `rules/buy`: "If the unit can't afford as many as [quantity], it will attempt to buy as many as
//! it can." Found verifying `ah-yvgi` on the committed turn 71: Seven of Eight (18642) in Inholm
//! (7,53), ordered `@CLAIM 50 / @STUDY OBSE / CLAIM 2000 / BUY 50 GEM`, buys 9 gems at $213.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{ShortBuy, SilverSpender, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

/// Seven of Eight (18642), with its `@study obse` line followed by `extra`.
fn seven_of_eight_with(extra: &str) -> UnitSilver {
    seven_of_eight_under(extra, &[])
}

/// The same, with `edits` applied to the template first - each must find its text.
fn seven_of_eight_under(extra: &str, edits: &[(&str, &str)]) -> UnitSilver {
    let text = atlantis_hud_fixtures::G7_F95_T71.text;
    let mut orders = extract_orders_template(text)
        .expect("the committed turn 71 carries an orders template")
        .text;
    for (from, to) in edits {
        assert!(orders.contains(from), "the template still holds {from:?}");
        orders = orders.replacen(from, to, 1);
    }
    let from = "unit 18642\n";
    let at = orders.find(from).expect("the template holds unit 18642");
    let study = orders[at..]
        .find("@study obse\n")
        .map(|offset| at + offset + "@study obse\n".len())
        .expect("18642 studies observation");
    let orders = format!("{}{extra}{}", &orders[..study], &orders[study..]);
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset());
    review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default())
        .silver
        .into_iter()
        .find(|silver| silver.unit_id == "18642")
        .expect("Seven of Eight (18642) has a SILVER row")
}

#[test]
fn a_purchase_cut_short_says_how_many_it_buys_of_how_many_ordered() {
    let unit = seven_of_eight_with("CLAIM 2000\nBUY 50 GEM\n");
    assert_eq!(unit.short_on, Some(SilverSpender::Buy), "{unit:?}");
    assert_eq!(
        unit.short_buy,
        Some(ShortBuy {
            ordered: 50,
            bought: 9,
            ordered_named: "50 gems".to_string(),
        }),
        "{unit:?}"
    );
}

#[test]
fn a_purchase_it_can_pay_none_of_buys_none() {
    let unit = seven_of_eight_with("BUY 50 GEM\n");
    assert_eq!(unit.short_on, Some(SilverSpender::Buy), "{unit:?}");
    assert_eq!(
        unit.short_buy.as_ref().map(|buy| (buy.ordered, buy.bought)),
        Some((50, 0)),
        "{unit:?}"
    );
}

#[test]
fn a_shortfall_on_anything_but_a_purchase_carries_no_purchase() {
    // Without its $50 claim 18642 holds nothing to pay its study with.
    let unit = seven_of_eight_under("", &[("@claim 50\n@study obse", "@study obse")]);
    // 18642 holds no silver of its own, so its study is refused: carried on its own rather than
    // as a shortfall, so nothing is named and no purchase carried (`ah-rjz2`).
    assert_eq!(unit.short_for_orders, Some(0), "{unit:?}");
    assert_eq!(unit.short_on, None, "{unit:?}");
    assert_eq!(unit.refused.len(), 1, "{unit:?}");
    assert_eq!(unit.short_buy, None, "{unit:?}");
}
