//! `ah-9lyr`. A refused TRANSPORT/DISTRIBUTE is worded once, in core: the unit preview carries the
//! sentence core rendered (`TransportTargetIssue::sentence`) and the order's warning composes the
//! same clauses, so for one settled refusal with an exact amount the two read identically.
//!
//! The fixture is `ah-lis2`'s: `mountain (36,4)` of the committed turn 42 holds Ivanhoe (683) and
//! Robin Hood (1162), both ours and neither a quartermaster.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions};
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn orders(line: &str) -> String {
    format!("#atlantis 42 \"<password>\"\n\nunit 683\n{line}\n")
}

fn problems(orders: &str) -> Vec<String> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code == codes::TRANSPORT_TARGET_REFUSED)
        .map(|finding| finding.message)
        .collect()
}

fn hover(orders: &str) -> Vec<String> {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        atlantis_hud_fixtures::G3_F42_T42.text,
        "[]",
        orders,
    )
    .expect("the ruleset loads")
    .regions
    .iter()
    .flat_map(|region| region.units.iter())
    .filter(|row| row.unit.unit_id == "683")
    .flat_map(|row| row.transport_target_issues.iter())
    .map(|issue| issue.sentence.clone())
    .collect()
}

#[test]
fn a_transport_to_a_unit_that_is_not_a_quartermaster() {
    let orders = orders("TRANSPORT 1162 100 SILV");
    assert_eq!(
        hover(&orders),
        vec!["Unit 1162 is not a quartermaster, so 100 SILV stay with this unit.".to_string()]
    );
    assert_eq!(hover(&orders), problems(&orders));
}

#[test]
fn a_distribute_from_a_unit_that_is_not_a_quartermaster() {
    let orders = orders("DISTRIBUTE 1162 100 SILV");
    assert_eq!(
        hover(&orders),
        vec!["This unit is not a quartermaster, so 100 SILV stay with this unit.".to_string()]
    );
    assert_eq!(hover(&orders), problems(&orders));
}
