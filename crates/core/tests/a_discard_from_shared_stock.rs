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
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
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
        preview_row(&report, &response, "12878").is_none_or(|row| sword_changes(row).is_empty()),
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
    // Today's shortage warning here is the hex's, since the swords are shared: the agreed
    // experience keeps it unchanged, and Problems lists it beside the new one.
    let hex_short: Vec<_> = short
        .iter()
        .filter(|finding| finding.code.as_str() == "not-enough-items")
        .map(|finding| (finding.unit_id.as_deref(), finding.message.as_str()))
        .collect();
    assert_eq!(
        hex_short,
        [(
            None,
            "the units in this hex are short 30 swords between them: they can have 60 and their \
             orders spend 90"
        )]
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
/// only what it holds; men are disbanded from its own count (two leaders, where Two of Seven holds
/// one and sharers hold more); the dragons the engine releases come from its own stock (it holds
/// 3, sharers hold more); silver keeps its own words.
#[test]
fn a_discard_that_reaches_no_faction_mate_says_nothing_new() {
    for orders in [
        "unit 12880\nGIVE 0 20 SWOR\n",
        "unit 12878\nGIVE 0 ALL SWOR\n",
        "unit 12878\nGIVE 0 2 LEAD\n",
        "unit 12878\nGIVE 0 4 DRAG\n",
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

/// Two of Seven (12878)'s own block from the report's orders template: every one of its
/// `@give 0 all <item>` lines names a good it does not hold, so each moves nothing.
const TEMPLATE_BLOCK: &str = "@STUDY FORC\n@CAST eswo\n@GIVE 2396 ALL MSWO\n@COMBAT STOR\n\
    @give 0 all hors\n@give 0 all fur\n@give 0 all lass\n@give 0 all herb\n@give 0 all ston\n\
    @give 0 all iron\n@give 0 all wood\n@give 0 all spea\n@give 0 all came\n";

/// The case the failed verification found (2026-10-17): the player adds the discard to the block
/// the template gave them, and the web shell validates through `validate_orders_request`. A give
/// naming a good the unit does not hold moves nothing, so it cannot make who lost what unknowable.
#[test]
fn the_template_s_own_discards_do_not_silence_the_warning() {
    let result = validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: format!("#atlantis 95\nunit 12878\n{TEMPLATE_BLOCK}GIVE 0 30 SWOR\n#end\n"),
            ruleset_json: Some(atlantis_hud_fixtures::RULESET_JSON.to_string()),
            raw_report: Some(the_report()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some("[]".to_string()),
        },
    );
    let told: Vec<_> = result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "discard-from-shared-stock")
        .map(|diagnostic| {
            (
                diagnostic.unit_id.as_deref(),
                diagnostic.line_start,
                diagnostic.message.as_str(),
            )
        })
        .collect();
    assert_eq!(
        told,
        [(
            Some("12878"),
            Some(16),
            "This discard takes 30 swords from Four of Seven (12880)'s shared stock: this unit \
             holds none."
        )]
    );
}

/// What a class the data page never lists the members of moves cannot be said (`ADVANCED`,
/// `transfers::class_members`), so after one the discard's draws cannot be vouched for either.
#[test]
fn a_class_the_walk_cannot_list_still_silences_it() {
    let findings = findings(
        "unit 12878\nGIVE 0 ALL ADVANCED\nGIVE 0 30 SWOR\n",
        CheckOptions::default(),
    );
    let told: Vec<_> = findings
        .iter()
        .filter(|finding| finding.code.as_str() == "discard-from-shared-stock")
        .collect();
    assert!(told.is_empty(), "{told:?}");
}
