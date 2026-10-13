//! A study a sharing faction-mate pays for is not called short (`ah-41yw`).
//!
//! `newage trident rules/share`: a sharing unit "will provide silver for buying or studying". The
//! navigator met it in the Arcanum report: Gagcrash the Scruffy (6017) holds no silver and does
//! not share; unit 4931 in the same volcano shares and holds plenty. Given `STUDY ENTE`, 4931's
//! SILVER cell dropped by the fee while the Skills popup said the study "may not happen at all" -
//! the two surfaces disagreeing about who paid.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, StudyForecast};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{SilverChangeCause, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::trident_ruleset;

const STUDENT: &str = "6017";
const SHARER: &str = "4931";

fn report() -> &'static str {
    atlantis_hud_fixtures::NEWAGE_ARCANUM_F5_T84.text
}

/// The report's own template, with `STUDY ENTE` written into the student's block.
fn orders() -> String {
    let template = extract_orders_template(report())
        .map(|template| template.text)
        .expect("the report carries an orders template");
    let block = format!("unit {STUDENT}\n");
    assert!(
        template.contains(&block),
        "the template has a block for the student"
    );
    template.replacen(&block, &format!("{block}STUDY ENTE\n"), 1)
}

fn study() -> StudyForecast {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        report(),
        "[]",
        &orders(),
    )
    .expect("the Trident ruleset loads");
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == STUDENT)
        .and_then(|unit| unit.study.clone())
        .expect("the student's study is forecast")
}

fn silver(unit_id: &str) -> UnitSilver {
    let mut parsed = parse_report_full(report());
    classify_units(&mut parsed, &trident_ruleset());
    review_turn(
        &parsed,
        &orders(),
        Some(&trident_ruleset()),
        CheckOptions::default(),
    )
    .silver
    .into_iter()
    .find(|silver| silver.unit_id == unit_id)
    .unwrap_or_else(|| panic!("the silver column has a row for unit {unit_id}"))
}

#[test]
fn the_popup_and_the_sharers_silver_agree_the_purse_paid() {
    let study = study();
    assert!(
        study.doubts.is_empty(),
        "the sharer's purse pays the fee, so nothing is short: {study:?}"
    );
    assert!(
        study.points_after > study.points_before,
        "the month's progress is shown: {study:?}"
    );

    // The same fee leaves the sharer's purse, as its SILVER cell already said.
    let sharer = silver(SHARER);
    let lent: i64 = sharer
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Lent)
        .map(|change| change.amount)
        .sum();
    assert_eq!(
        lent, -10,
        "the sharer pays the $10 fee: {:?}",
        sharer.changes
    );
}
