//! A lone `SELL ALL` of more than the market wants is not a warning (`ah-up48`).
//!
//! `rules/sell`: `SELL ALL` "will attempt to sell all of that item, regardless of how many it
//! has", and the market takes what it wants. The reference case is unit 8333 in Lonthax on
//! `neworigins-3.0.0-g5-f21-t24`: its template orders `@sell all grai`, it ends the GIVE phase with
//! 316 grain, and the market wants 196. Before this bead the review said "this unit sells 316
//! grain and this market wants 196" and counted it in "To check".

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

#[test]
fn unit_8333s_sell_all_grain_is_not_counted_as_oversubscribed() {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    assert!(
        orders.contains("unit 8333\n") && orders.contains("@sell all grai"),
        "the fixture still orders unit 8333 to SELL ALL GRAI"
    );

    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());

    let on_8333: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| {
            finding.code.as_str() == "region-pool-oversubscribed"
                && finding.unit_id.as_deref() == Some("8333")
        })
        .collect();
    assert!(on_8333.is_empty(), "{on_8333:?}");
}
