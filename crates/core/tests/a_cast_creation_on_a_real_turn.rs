//! A summoning `CAST` on a committed report reaches the ITEMS surface as a range, moved here from
//! the smoke suite so a settlement change edits a Rust test rather than a browser walk
//! (`ah-sybfj`).
//!
//! `data/WOLF`: "A mage may summon a number of wolves averaging 200 percent times his skill level".
//! On `g5f21t23`, unit 1294 "Five of Eight" holds `wolf lore [WOLF] 2` and no wolves, so
//! `CAST Wolf_Lore` summons an averaged 400 percent - the 1-8 the ITEMS cell draws.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, CreatedItem};
use atlantis_hud_core::report::orders::extract_orders_template;

use crate::common;

#[test]
fn a_level_two_wolf_lore_cast_summons_one_to_eight_wolves() {
    let text = atlantis_hud_fixtures::G5_F21_T23.text;
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\nunit 1294\nCAST Wolf_Lore\n");

    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &orders,
    )
    .expect("the ruleset loads");

    let mage = common::expect_preview_row(text, &response, "1294");
    assert_eq!(
        mage.created,
        vec![CreatedItem {
            fewest: 1,
            most: 8,
            tag: "WOLF".to_string(),
            summoned: true,
        }]
    );
}
