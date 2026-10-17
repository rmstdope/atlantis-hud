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

#[test]
fn the_discard_line_names_the_faction_mate_whose_swords_go() {
    let findings = findings("unit 12878\nGIVE 0 30 SWOR\n", CheckOptions::default());
    assert_eq!(
        on_the_discard(&findings, "discard-from-shared-stock"),
        ["This discard takes 30 swords from Four of Seven (12880)'s shared stock: this unit holds \
          none."],
        "{findings:?}"
    );
}

/// 90 against the 60 the two sharers hold: the game discards all 60 and says "Not enough.", so
/// the line carries today's shortage warning and the new one (`ah-84b1`, the agreed exception to
/// one warning per line).
#[test]
fn a_discard_beyond_even_the_shared_stock_carries_both_warnings() {
    let both = findings("unit 12878\nGIVE 0 90 SWOR\n", CheckOptions::default());
    assert_eq!(
        on_the_discard(&both, "discard-from-shared-stock"),
        [
            "This discard takes 30 swords from Four of Seven (12880)'s and 30 from Five of Seven \
          (12881)'s shared stock: this unit holds none."
        ],
        "{both:?}"
    );
    let today = findings("unit 12878\nGIVE 0 90 SWOR\n", switched_off());
    let short: Vec<_> = today
        .iter()
        .filter(|finding| finding.code.as_str() != "discard-from-shared-stock")
        .collect();
    let with_both: Vec<_> = both
        .iter()
        .filter(|finding| finding.code.as_str() != "discard-from-shared-stock")
        .collect();
    assert_eq!(with_both, short, "the shortage warnings are unchanged");
    assert!(
        short.iter().any(|finding| finding.unit_id.as_deref() == Some("12878")
            || finding.unit_id.is_none()),
        "and there is one: {short:?}"
    );
}

#[test]
fn switched_off_the_line_says_nothing_new() {
    let findings = findings("unit 12878\nGIVE 0 30 SWOR\n", switched_off());
    assert!(on_the_discard(&findings, "discard-from-shared-stock").is_empty());
}

/// The default options with this bead's warning switched off in Settings.
fn switched_off() -> CheckOptions {
    let mut options = CheckOptions::default();
    options
        .disabled
        .insert("discard-from-shared-stock".to_string());
    options
}

/// Only the part taken from faction-mates is counted: Four of Seven holds 30 and discards 40.
#[test]
fn a_discard_partly_its_own_counts_only_what_the_mates_lose() {
    let findings = findings("unit 12880\nGIVE 0 40 SWOR\n", CheckOptions::default());
    let told: Vec<_> = findings
        .iter()
        .filter(|finding| {
            finding.code.as_str() == "discard-from-shared-stock"
                && finding.unit_id.as_deref() == Some("12880")
                && finding.line == Some(2)
        })
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(
        told,
        ["This discard takes 10 swords from Five of Seven (12881)'s shared stock: this unit holds \
          only 30 of the 40."]
    );
}

/// What the agreed experience leaves unwarned: the unit holds everything it discards; `ALL` is
/// only what it holds; men are disbanded from its own count; silver keeps its own words.
#[test]
fn a_discard_that_reaches_no_faction_mate_says_nothing_new() {
    for orders in [
        "unit 12880\nGIVE 0 20 SWOR\n",
        "unit 12878\nGIVE 0 ALL SWOR\n",
        "unit 12878\nGIVE 0 1 LEAD\n",
        "unit 12878\nGIVE 0 100000 SILV\n",
    ] {
        let findings = findings(orders, CheckOptions::default());
        let told: Vec<_> = findings
            .iter()
            .filter(|finding| finding.code.as_str() == "discard-from-shared-stock")
            .collect();
        assert!(told.is_empty(), "{orders:?}: {told:?}");
    }
}
