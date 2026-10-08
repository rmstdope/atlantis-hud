//! A builder supplied by a sharer arriving this turn reads like any other supplied build
//! (`ah-9ctt`), on the real Borg 21 turn 39 report where the navigator met it.
//!
//! Builder 12624 in plain (35,43) orders `BUILD Caravanserai`; sharer 8333 (`SHARE` on, 150 wood
//! and 74 stone) in plain (36,44) moves `NW` into the builder's hex. `rules/sequenceofevents`
//! moves units before `BUILD`, and `rules/share` lends to faction-mates in the same region, so
//! since `ah-7r9p` the sharer's stock supplies the build and is charged to the sharer's own row.
//!
//! What still went wrong was the material: the sharer brings **both** wood and stone, and
//! New Origins' `rules/build` names no default between them, so the build was marked uncounted - a
//! `+ ?` on the builder's ITEMS column. The navigator chose (bead notes, 2026-10-09) to read a
//! New Origins `BUILD` as New Age Trident's `rules/build` states its default - *"consuming stone
//! before wood"* - so the build is counted and stone leaves first.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, ItemChangeCause, OrdersPreviewResponse,
};
use atlantis_hud_core::report::orders::extract_orders_template;

mod common;

const BUILDER: &str = "12624";
const SHARER: &str = "8333";

fn preview(text: &str) -> OrdersPreviewResponse {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let template = common::without_standing_month_orders(&template, &[BUILDER, SHARER]);
    for unit in [BUILDER, SHARER] {
        assert_eq!(
            template.matches(&format!("unit {unit}\n")).count(),
            1,
            "the fixture's template names unit {unit} exactly once"
        );
    }
    let orders = template
        .replace("unit 12624\n", "unit 12624\nbuild caravanserai\n")
        .replace("unit 8333\n", "unit 8333\nmove nw\n");
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &orders,
    )
    .expect("the committed ruleset loads")
}

#[test]
fn an_arriving_sharers_wood_and_stone_supply_a_build_stone_first() {
    let text = atlantis_hud_fixtures::G5_F21_T39.text;
    let preview = preview(text);

    // The builder's row carries no `+ ?`: either it has no row at all (its items do not change,
    // the material leaving the sharer's row) or a row with nothing uncounted.
    if let Some(builder) = common::preview_row(text, &preview, BUILDER) {
        assert!(
            builder.uncounted.is_empty(),
            "the build is counted, not marked uncounted: {:?}",
            builder.uncounted
        );
    }

    let sharer = common::expect_preview_row(text, &preview, SHARER);
    let built_from = |tag: &str| -> i64 {
        sharer
            .item_changes
            .iter()
            .filter(|change| change.tag == tag && change.cause == ItemChangeCause::BuildSpent)
            .inspect(|change| {
                assert_eq!(
                    change.other.as_ref().map(|party| party.unit_id.as_str()),
                    Some(BUILDER),
                    "the sharer's debit names the builder"
                );
            })
            .map(|change| change.delta)
            .sum()
    };
    assert!(
        built_from("STON") < 0,
        "the build spends the sharer's stone first: {:?}",
        sharer.item_changes
    );
    assert_eq!(
        built_from("WOOD"),
        0,
        "74 stone covers the month's work, so no wood leaves"
    );
}
