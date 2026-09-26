//! The core half of `ah-5znb`'s failed verification, on the navigator's own report.
//!
//! In `newage-arcanum-f3-t84`, Shelihn of the Lost Wolf (684) is the only unit of ours in desert
//! (12,10): one wood elf with no silver, carrying the `sharing` flag. Ordered to `STUDY ENTE`
//! instead of its template's `@entertain`, it can pay neither the study nor its upkeep. Because it
//! shares, its hex's silver is pooled, so the shortfall is anchored to the hex and names no unit.
//!
//! The Silver popup reads exactly that shape (`hexesShortOfSilver`, `packages/shared`) and keys it
//! on the unit's forecast's `region_id`. If either half changed, the popup would go back to saying
//! "Shared silver in this hex covers the shortfall" of a unit nothing can feed.

use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

#[test]
fn a_lone_sharer_that_cannot_pay_is_warned_against_its_hex() {
    let raw = atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text;
    let ruleset = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON)
        .expect("the committed Arcanum ruleset loads");
    let mut parsed = parse_report_full(raw);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(raw)
        .expect("the report carries a template")
        .text;
    let orders = template.replace(
        "entertainment [ENTE] 1 (50).\n@entertain\n",
        "entertainment [ENTE] 1 (50).\nSTUDY ENTE\n",
    );
    assert_ne!(orders, template, "the template's block for 684 was found");

    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
    let forecast = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "684")
        .expect("684 has a forecast");
    assert!(
        forecast.at_month_end.expect("priced") < 0,
        "684 cannot pay for its study: {forecast:?}"
    );

    let short: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "not-enough-silver")
        .filter(|finding| finding.region_id == forecast.region_id)
        .collect();
    assert!(
        !short.is_empty() && short.iter().all(|finding| finding.unit_id.is_none()),
        "one hex-anchored shortfall, naming no unit: {short:?}"
    );
}
