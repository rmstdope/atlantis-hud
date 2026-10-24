//! Drones (10594) in the Borg (21) turn 24 report stands aboard Raft [235] in plain (36,44)
//! with no silver, `SHARE` set and `STUDY FISH` ($200) as its order. Its captain Drones (10575)
//! shares too and is given `SAIL SE`.
//!
//! `ah-6cka` takes a leaver's **upkeep** off the purse of the hex it leaves:
//! `rules/sequenceofevents` assesses maintenance after movement, and `rules/economy_maintenance`
//! shares for it only "between your units in the same region". The passenger's study loan is not
//! upkeep, so it must stay a loan, with no shortfall said - lent since `ah-q1zz` by Drones (9508)
//! where the raft lands, as the real turn 25 has it
//! (`an_arriving_crew_lends_upkeep_after_the_residents.rs`). A first version capped every
//! claim after movement, and it gave this passenger a false not-enough-silver finding that only
//! an unrelated browser smoke test caught.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::shipment_measures;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

#[test]
fn a_sailing_sharing_passenger_keeps_the_loan_for_its_study() {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    assert_eq!(template.matches("unit 10575\n").count(), 1);
    assert!(
        template.contains("unit 10594\n"),
        "the passenger has a block"
    );
    let orders = template.replace("unit 10575\n", "unit 10575\nSAIL SE\n");

    let measures = shipment_measures(
        &mut ReportCache::default(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &orders,
        "",
        CheckOptions::default(),
    )
    .expect("the trace runs");
    assert!(
        measures.month_end.contains_key("10594"),
        "the passenger sails away with its fleet"
    );
    let review = review_turn(
        &parsed,
        &orders,
        Some(&ruleset),
        CheckOptions {
            month_end: measures.month_end,
            ..CheckOptions::default()
        },
    );

    let passenger = review
        .silver
        .iter()
        .find(|row| row.unit_id == "10594")
        .expect("the passenger is forecast");
    assert_eq!(passenger.borrowed_for_orders, 200, "{passenger:?}");
    assert_eq!(passenger.at_month_end, Some(0), "{passenger:?}");
    let said: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| finding.unit_id.as_deref() == Some("10594"))
        .map(|finding| (finding.code, finding.message.as_str()))
        .collect();
    assert!(said.is_empty(), "{said:?}");
}
