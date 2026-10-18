//! `ah-lis2`. A DISTRIBUTE from a unit that is not a quartermaster is refused for the sender's
//! missing skill, not for anything about its target.
//!
//! `rules/transport` calls DISTRIBUTE a synonym of TRANSPORT, but the engine does not treat it as
//! one: `../Atlantis` `runorders.cpp` `CheckTransportOrders` asks a TRANSPORT's *target* for the
//! quartermaster skill and a transport structure, and asks a DISTRIBUTE's *issuer* instead -
//! "DISTRIBUTE: Unit is not a quartermaster" - whatever the target is.
//!
//! `mountain (36,4)` of the committed turn 42 holds Ivanhoe, son of Cedric (683) and Robin Hood
//! (1162), both ours and neither a quartermaster (`neworigins-3.0.0-g3-f42-t42.rep:1352`, `:1489`).
//! Before the fix both the order and the unit preview blamed Robin Hood.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, TransportTargetReason,
};
use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::SilverChangeCause;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn orders(line: &str) -> String {
    format!("#atlantis 42 \"<password>\"\n\nunit 683\n{line}\n")
}

/// The refusal warnings at the order lines, as (unit, line, message).
fn refusals(orders: &str) -> Vec<(Option<String>, Option<usize>, String)> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code == codes::TRANSPORT_TARGET_REFUSED)
        .map(|finding| (finding.unit_id, finding.line, finding.message))
        .collect()
}

#[test]
fn ivanhoes_distribute_names_his_own_missing_skill_at_the_order() {
    assert_eq!(
        refusals(&orders("DISTRIBUTE 1162 100 SILV")),
        vec![(
            Some("683".to_string()),
            Some(4),
            "This unit is not a quartermaster, so 100 SILV stay with this unit.".to_string()
        )]
    );
}

#[test]
fn a_distribute_with_no_amount_to_name_is_not_called_a_transport() {
    assert_eq!(
        refusals(&orders("DISTRIBUTE 1162 ALL SILV")),
        vec![(
            Some("683".to_string()),
            Some(4),
            "This unit is not a quartermaster, so this DISTRIBUTE moves nothing.".to_string()
        )]
    );
}

#[test]
fn ivanhoes_distribute_names_his_own_missing_skill_in_the_preview() {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        atlantis_hud_fixtures::G3_F42_T42.text,
        "[]",
        &orders("DISTRIBUTE 1162 100 SILV"),
    )
    .expect("the ruleset loads");
    let issues: Vec<_> = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|row| row.unit.unit_id == "683")
        .flat_map(|row| row.transport_target_issues.iter())
        .map(|issue| {
            (
                issue.to.as_str(),
                issue.amount,
                issue.reason,
                issue.distribute,
            )
        })
        .collect();
    assert_eq!(
        issues,
        vec![(
            "1162",
            100,
            TransportTargetReason::SenderNotQuartermaster,
            true
        )]
    );
}

/// The TRANSPORT that `ah-kjjv` pinned still blames the target: only a DISTRIBUTE asks the sender.
#[test]
fn a_transport_to_the_same_unit_still_blames_the_target() {
    assert_eq!(
        refusals(&orders("TRANSPORT 1162 100 SILV")),
        vec![(
            Some("683".to_string()),
            Some(4),
            "Unit 1162 is not a quartermaster, so 100 SILV stay with this unit.".to_string()
        )]
    );
}

/// A sender studying the skill this month may be a quartermaster when the shipments run
/// (`rules/sequenceofevents` processes STUDY before TRANSPORT), so its own month leaves the refusal
/// unsettled and the order carries no warning; the preview still holds the doubt (`ah-lis2` review,
/// finding 1).
#[test]
fn a_sender_studying_the_skill_is_not_warned() {
    assert_eq!(
        refusals(&orders("STUDY QUAM\nDISTRIBUTE 1162 100 SILV")),
        vec![]
    );
}

/// `ah-7jsv`. A refused `ALL SILV` names what `ALL` would have taken when the shipments run, not
/// the report's holding: `rules/sequenceofevents` processes CAST and STUDY before TRANSPORT, so
/// their silver has already left Ivanhoe's 2890 by then. Before the fix the hover said 2890 while
/// the same hover's month end said less.
fn the_silver_named_by_a_refused_all_silv(script: &str) -> (Vec<(String, i64, String)>, i64) {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    let spent_before_transport: i64 =
        review_turn(&parsed, script, Some(&ruleset), CheckOptions::default())
            .silver
            .into_iter()
            .find(|silver| silver.unit_id == "683")
            .expect("Ivanhoe's silver is forecast")
            .changes
            .iter()
            .filter(|change| {
                matches!(
                    change.cause,
                    SilverChangeCause::Studied | SilverChangeCause::CastSpent
                )
            })
            .map(|change| change.amount)
            .sum();
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        atlantis_hud_fixtures::G3_F42_T42.text,
        "[]",
        script,
    )
    .expect("the ruleset loads");
    let issues = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|row| row.unit.unit_id == "683")
        .flat_map(|row| row.transport_target_issues.iter())
        .inspect(|issue| {
            assert_eq!(issue.reason, TransportTargetReason::SenderNotQuartermaster);
        })
        .map(|issue| (issue.to.clone(), issue.amount, issue.tag.clone()))
        .collect();
    (issues, spent_before_transport)
}

#[test]
fn a_refused_all_silv_names_the_silver_left_after_study() {
    let (issues, spent) =
        the_silver_named_by_a_refused_all_silv(&orders("STUDY TRUE\nDISTRIBUTE 1162 ALL SILV"));
    assert!(spent < 0, "the study fee is booked: {spent}");
    assert_eq!(
        issues,
        vec![("1162".to_string(), 2890 + spent, "SILV".to_string())]
    );
}

/// The verifier's own month (`ah-7jsv`): a CAST and a STUDY both paid before the shipments run.
#[test]
fn a_refused_all_silv_names_the_silver_left_after_cast_and_study() {
    let (issues, spent) = the_silver_named_by_a_refused_all_silv(&orders(
        "CAST CFSW\nSTUDY TRUE\nDISTRIBUTE 1162 ALL SILV",
    ));
    assert!(
        spent < -100,
        "the cast and the study fee are booked: {spent}"
    );
    assert_eq!(
        issues,
        vec![("1162".to_string(), 2890 + spent, "SILV".to_string())]
    );
}

/// The same refusal to a unit the report never names: the sender's own missing skill settles it
/// whatever the target is, so the hover still names a figure, and it is the one left when the
/// shipments run (`ah-7jsv` review, finding 1).
#[test]
fn a_refused_all_silv_to_an_unshown_unit_names_the_silver_left_after_study() {
    let (issues, spent) =
        the_silver_named_by_a_refused_all_silv(&orders("STUDY TRUE\nDISTRIBUTE 99999 ALL SILV"));
    assert!(spent < 0, "the study fee is booked: {spent}");
    assert_eq!(
        issues,
        vec![("99999".to_string(), 2890 + spent, "SILV".to_string())]
    );
}

/// Where the month has spent everything before the shipments run, `ALL` would take nothing: the
/// hover names no amount and says the order moves nothing, as the order line does (`ah-7jsv`
/// review, finding 3).
#[test]
fn a_refused_all_silv_with_nothing_left_names_no_amount() {
    let (issues, _) = the_silver_named_by_a_refused_all_silv(&orders(
        "GIVE 1162 2190 SILV\nCAST CFSW\nSTUDY TRUE\nDISTRIBUTE 1162 ALL SILV",
    ));
    assert_eq!(issues, vec![("1162".to_string(), 0, String::new())]);
}
