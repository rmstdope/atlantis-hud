//! A sharer whose silver a faction-mate's GIVE drains still studies, paid by the hex's purse
//! (`ah-d3in`).
//!
//! Fleet hex ocean (26,52) of Borg TNG (95) turn 71, template orders. Six of Two (13402, sharing,
//! 12720 silver) is given `GIVE 881 20000 SILV`; its own 12720 is 7280 short, and the sharers make
//! that up in report order - Nine of Eight (13403, sharing, 413 silver, `@study comb`) first.
//!
//! `rules/sequenceofevents` runs GIVE in the Give phase, well before STUDY. `rules/share`: a sharing
//! unit "will provide silver for buying or studying" - and by STUDY Six of Seven (881, sharing)
//! holds the 20000. So 13403's study is paid from the hex's purse, not refused: nothing is short,
//! and its 413 leaves in the Give phase, not after a study it paid for itself.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

const DRAINED: &str = "13403";

fn review(gift: i64) -> TurnReview {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G7_F95_T71.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    assert_eq!(template.matches("unit 13402\n").count(), 1);
    let orders = template.replacen(
        "unit 13402\n",
        &format!("unit 13402\nGIVE 881 {gift} SILV\n"),
        1,
    );
    review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default())
}

fn row_of(review: &TurnReview, unit_id: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .cloned()
        .unwrap_or_else(|| panic!("unit {unit_id} is forecast"))
}

fn row(gift: i64, unit_id: &str) -> UnitSilver {
    row_of(&review(gift), unit_id)
}

#[test]
fn a_sharer_a_give_drains_is_not_short_of_its_study() {
    let drained = row(20000, DRAINED);
    assert_eq!(
        drained.short_for_orders,
        Some(0),
        "the purse pays the study: {drained:#?}"
    );
    assert_eq!(drained.short_on, None, "{drained:#?}");
    assert_eq!(drained.at_month_end, Some(0), "{drained:#?}");
}

#[test]
fn the_drained_sharers_silver_leaves_in_the_give_and_its_study_is_lent() {
    let drained = row(20000, DRAINED);
    let lent_for_the_give: i64 = drained
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Lent)
        .map(|change| change.amount)
        .sum();
    assert_eq!(
        lent_for_the_give, -413,
        "all 413 leave for the GIVE: {:#?}",
        drained.changes
    );
    assert_eq!(
        drained.borrowed_for_orders, 10,
        "the purse pays the 10 the study costs: {drained:#?}"
    );
}

/// The bead's comparison: a GIVE Six of Two's own 12720 covers draws nothing on the sharers, and
/// Nine of Eight's study was never in question.
#[test]
fn a_give_the_sharer_need_not_fund_leaves_its_study_alone() {
    let drained = row(1000, DRAINED);
    assert_eq!(drained.short_for_orders, Some(0), "{drained:#?}");
    assert_eq!(drained.short_on, None, "{drained:#?}");
}

/// The two readers of the Give-phase draw in one assertion (`ah-izmv`): the SILVER column, which
/// reads the 413 gone from the Give phase on, and the SHARE purse, which lends the whole draw and
/// never nets it against the study fee it lends back. A change to either alone - the column
/// counting the draw differently, or the purse netting it - breaks one of these while the other
/// still holds, so they are asserted together.
///
/// The findings are asserted with them, as no `not-enough-silver` on 13403, but that part guards
/// against a false warning rather than catching a reader change: the warning judges the hex's
/// pool as a whole, which here holds the 20000, so none reached 13403 under any of the four
/// mutations tried on this bead - the purse netting the draw, the purse skipping the Give phase,
/// the column ignoring what was lent at it, or `GiveDraws::lent_by` reading nothing (PR #1675).
#[test]
fn a_drained_sharers_column_loan_and_findings_agree() {
    let review = review(20000);
    let drained = row_of(&review, DRAINED);
    let lent: i64 = drained
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Lent)
        .map(|change| change.amount)
        .sum();
    let short: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| {
            finding.unit_id.as_deref() == Some(DRAINED)
                && finding.code.as_str() == "not-enough-silver"
        })
        .collect();
    assert_eq!(
        (
            lent,
            drained.borrowed_for_orders,
            drained.short_for_orders,
            drained.at_month_end,
            short.len(),
        ),
        (-413, 10, Some(0), Some(0), 0),
        "column, loan and findings: {drained:#?} {short:#?}"
    );
}
