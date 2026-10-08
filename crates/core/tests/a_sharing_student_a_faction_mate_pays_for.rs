//! Unit 9932 in the Borg (21) turn 39 report studies with no silver of its own, and a
//! faction-mate's `SHARE` pays the fee, so it ends the month at 0 rather than in the red
//! (`ah-0nwd`).
//!
//! `rules/share`: *"a unit with a supply of silver could automatically provide silver if any of
//! your other units in the same region does not have enough to perform an action, such as
//! studying, buying or producing."* 9932 itself shares; that is what the column used to read as
//! "this debt is its own".
//!
//! The scene the navigator found it in: mountain (35,45). 9932 (three men, no silver) has
//! `STUDY MINI`, 3154 turns its sharing off with `SHARE 0`, and sharer 8333 walks in from plain
//! (36,44) with `MOVE SW`. The month end is traced from the orders exactly as the shells trace it.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::shipment_measures;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::{ruleset, without_standing_month_orders};

/// The turn's own orders, with the scene's three written in, and 9932 studying or not.
fn review(studies: bool) -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T39.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let template = without_standing_month_orders(&template, &["9932", "8333"]);
    for header in ["unit 9932\n", "unit 3154\n", "unit 8333\n"] {
        assert_eq!(template.matches(header).count(), 1, "{header:?} once");
    }
    let orders = template
        .replace(
            "unit 9932\n",
            if studies {
                "unit 9932\nSTUDY MINI\n"
            } else {
                "unit 9932\n"
            },
        )
        .replace("unit 3154\n", "unit 3154\nSHARE 0\n")
        .replace("unit 8333\n", "unit 8333\nMOVE SW\n");

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
        measures.month_end.contains_key("8333"),
        "the sharer's walk was traced"
    );
    let options = CheckOptions {
        month_end: measures.month_end,
        ..CheckOptions::default()
    };
    review_turn(&parsed, &orders, Some(&ruleset), options)
}

fn row<'r>(review: &'r TurnReview, unit_id: &str) -> &'r UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("unit {unit_id} is forecast"))
}

#[test]
fn unit_9932_a_walking_sharer_pays_for_ends_the_month_at_nothing() {
    let studying = review(true);
    let student = row(&studying, "9932");
    assert_eq!(student.borrowed_for_orders, 30, "{student:?}");
    assert_eq!(
        student.at_month_end,
        Some(0),
        "the fee a faction-mate paid is not its debt: {student:?}"
    );
    assert_eq!(student.short_for_orders, Some(0), "{student:?}");

    // And the walking sharer pays it, on its own row: 8333 also lends in the hex it leaves, so
    // what 9932's study costs it is measured against the same turn without the study.
    let end = |review: &TurnReview| row(review, "8333").at_month_end.expect("priced");
    assert_eq!(end(&review(false)) - end(&studying), 30);
}
