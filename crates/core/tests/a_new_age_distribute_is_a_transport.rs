//! In the New Age worlds DISTRIBUTE is only another spelling of TRANSPORT (`ah-i71ku`).
//!
//! `newage arcanum rules/distribute` (and `newage trident rules/distribute`): "For historical
//! reasons, the order DISTRIBUTE can be used in place of TRANSPORT and has the same meaning and
//! syntax." Before this bead a DISTRIBUTE kept New Origins' engine rules - its issuer had to own a
//! Caravanserai whatever the target - so a line TRANSPORT delivered was refused written as
//! DISTRIBUTE.

use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

fn review(orders: &str) -> TurnReview {
    let ruleset = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON)
        .expect("the committed Arcanum ruleset loads");
    let mut parsed = parse_report_full(atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
}

fn refusals(review: &TurnReview) -> Vec<String> {
    review
        .findings
        .iter()
        .filter(|finding| finding.code == codes::TRANSPORT_TARGET_REFUSED)
        .filter(|finding| finding.unit_id.as_deref() == Some("3178"))
        .map(|finding| finding.message.clone())
        .collect()
}

fn silver_at_month_end(review: &TurnReview, unit: &str) -> Option<i64> {
    review
        .silver
        .iter()
        .find(|silver| silver.unit_id == unit)
        .and_then(|silver| silver.at_month_end)
}

/// One finding's code, hex, unit, line and sentence.
type Read = (String, String, Option<String>, Option<usize>, String);

/// Every finding, as a person reads it, with the order's word read as TRANSPORT: a sentence may
/// name the line by the word it was written with (`ah-lis2`), and the word's own span with it.
fn findings(review: &TurnReview) -> Vec<Read> {
    review
        .findings
        .iter()
        .map(|finding| {
            (
                finding.code.to_string(),
                finding.region_id.clone(),
                finding.unit_id.clone(),
                finding.line,
                finding.message.replace("DISTRIBUTE", "TRANSPORT"),
            )
        })
        .collect()
}

/// Every unit's silver at the month's end.
fn forecast(review: &TurnReview) -> Vec<(String, Option<i64>)> {
    review
        .silver
        .iter()
        .map(|silver| (silver.unit_id.clone(), silver.at_month_end))
        .collect()
}

/// The verifier's case at forest (2,18): quartermaster 3178 owns no Caravanserai, and its
/// 100 silver for 2579 is delivered whichever word the line is written with.
#[test]
fn an_arcanum_distribute_from_3178_to_2579_is_delivered_as_its_transport_is() {
    let template = extract_orders_template(atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text)
        .expect("the report carries a template")
        .text;
    let with = |line: &str| template.replace("unit 3178\n", &format!("unit 3178\n{line}\n"));
    let baseline = review(&template);
    let transported = review(&with("TRANSPORT 2579 100 SILV"));
    let distributed = review(&with("DISTRIBUTE 2579 100 SILV"));

    assert_eq!(refusals(&transported), Vec::<String>::new());
    assert_eq!(refusals(&distributed), Vec::<String>::new());
    let delivered = silver_at_month_end(&baseline, "2579").map(|silver| silver + 100);
    assert!(delivered.is_some(), "2579's month end is a figure");
    assert_eq!(silver_at_month_end(&transported, "2579"), delivered);
    assert_eq!(silver_at_month_end(&distributed, "2579"), delivered);
    // The same findings and the same forecast, everywhere and not only on this line.
    assert_eq!(findings(&distributed), findings(&transported));
    assert_eq!(forecast(&distributed), forecast(&transported));
}
