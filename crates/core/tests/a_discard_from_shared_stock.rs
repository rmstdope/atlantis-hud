//! The case `ah-84b1` was filed from: ocean (26,52) of faction 95's turn 71, where Two of Seven
//! (12878), holding no swords, writes `GIVE 0 30 SWOR`.
//!
//! `rules/give`: "If 0 is specified as the unit number, then the items are discarded." The
//! engine's Give 0 branch (../Atlantis `runorders.cpp`, `Game::DoGiveOrder`) checks a numbered
//! discard against `Unit::GetSharedNum` - the unit's own goods and every sharing faction-mate's in
//! the region (`rules/share`) - and removes it with `Unit::ConsumeShared`, in report order. So
//! Four of Seven (12880)'s 30 swords go, and the player is told so on the line, and Four of
//! Seven's hover names the discarder.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, ItemChangeCause, UnitPreview,
};
use atlantis_hud_core::orders::semantics::{check_turn, CheckOptions};
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::{expect_preview_row, preview_row, ruleset};

fn the_report() -> String {
    atlantis_hud_fixtures::G7_F95_T71.text.to_string()
}

/// `(cause, delta, borrower)` for each SWOR change on the row.
fn sword_changes(unit: &UnitPreview) -> Vec<(ItemChangeCause, i64, Option<String>)> {
    unit.item_changes
        .iter()
        .filter(|change| change.tag == "SWOR")
        .map(|change| {
            (
                change.cause,
                change.delta,
                change.borrower.as_ref().map(|party| party.unit_id.clone()),
            )
        })
        .collect()
}

fn preview(
    orders: &str,
) -> (
    String,
    atlantis_hud_core::orders::effects::OrdersPreviewResponse,
) {
    let report = the_report();
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report,
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    (report, response)
}

#[test]
fn the_sharer_lends_its_swords_for_the_discard() {
    let (report, response) = preview("unit 12878\nGIVE 0 30 SWOR\n");

    let lender = expect_preview_row(&report, &response, "12880");
    assert!(
        preview_row(&report, &response, "12878").map_or(true, |row| sword_changes(row).is_empty()),
        "Two of Seven holds no swords, so none leave its own row"
    );
    assert_eq!(
        sword_changes(lender),
        [(
            ItemChangeCause::LentForDiscard,
            -30,
            Some("12878".to_string())
        )],
        "Four of Seven's 30 go, lent for Two of Seven's discard"
    );
}

fn findings(
    orders: &str,
    options: CheckOptions,
) -> Vec<atlantis_hud_core::orders::semantics::Finding> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(&the_report());
    classify_units(&mut parsed, &ruleset);
    check_turn(&parsed, orders, Some(&ruleset), options)
}

fn on_the_discard(
    findings: &[atlantis_hud_core::orders::semantics::Finding],
    code: &str,
) -> Vec<String> {
    findings
        .iter()
        .filter(|finding| {
            finding.code.as_str() == code
                && finding.unit_id.as_deref() == Some("12878")
                && finding.line == Some(2)
        })
        .map(|finding| finding.message.clone())
        .collect()
}
