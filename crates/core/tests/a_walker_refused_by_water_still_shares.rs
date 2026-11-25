//! `ah-wl6o0`. A walker whose MOVE the game refuses for water still shares its silver at home.
//!
//! `rules/move`: "A move can fail because the unit runs out of movement points, because the unit
//! attempts to move into the ocean, or because the unit attempts to enter a structure, and is
//! rejected." So the unit stays where it was, and its `sharing` flag still lends its silver to the
//! units beside it.
//!
//! In `neworigins-3.0.0-g5-f21-t39`, Unit (4333) is a sharing walker with 4109 silver on plain
//! (37,41), whose Southeast exit is ocean (38,42) and whose Southwest exit is plain (36,42). Drone
//! (8551) beside it holds no silver and studies longbow on 4333's money (the report's own event:
//! "Unit (4333) shares 10 silver [SILV] with Drone (8551).").
//!
//! The units-table half of the same misplacement is `move_into_water.rs` (`ah-71z6y`).

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::shipment_measures;
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::orders::semantics::CheckOptions;
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::orders::extract_orders_template;

const MAP: &str = r#"{"width":72,"height":96,"wrapX":false,"wrapY":false}"#;

/// The report's own template, with 4333's `@entertain` replaced by `order`. Only 4333's block is
/// touched: three other units' blocks end in the same skill line and `@entertain`, and 4329 among
/// them would walk onto (37,41) under MOVE SE and pay for 8551's study itself.
fn orders_with_4333_ordered(order: &str) -> String {
    let template = extract_orders_template(atlantis_hud_fixtures::G5_F21_T39.text)
        .expect("the report carries a template")
        .text;
    let block = template
        .find("unit 4333\n")
        .expect("the template has a block for 4333");
    let at = block
        + template[block..]
            .find("@entertain\n")
            .expect("4333's block ends in @entertain");
    assert!(
        !template[block..at].contains("\nunit "),
        "the @entertain found is 4333's own"
    );
    format!(
        "{}{order}\n{}",
        &template[..at],
        &template[at + "@entertain\n".len()..]
    )
}

/// Where the silver checks take 4333 to stand at month end, the hex its sharing counts in
/// (`rules/sequenceofevents`: maintenance is paid after the moves); `None` is where it stood.
fn month_end_of_4333(order: &str) -> Option<Coordinate> {
    shipment_measures(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        atlantis_hud_fixtures::G5_F21_T39.text,
        "[]",
        &orders_with_4333_ordered(order),
        MAP,
        CheckOptions::default(),
    )
    .expect("the ruleset loads")
    .month_end
    .get("4333")
    .copied()
}

/// The shortfalls the order check finds with 4333 given `order`.
fn shortfalls_with_4333_ordered(order: &str) -> Vec<String> {
    let raw = atlantis_hud_fixtures::G5_F21_T39.text;
    let orders = orders_with_4333_ordered(order);
    let request = ValidateOrdersRequest {
        raw_orders: orders,
        ruleset_json: Some(atlantis_hud_fixtures::RULESET_JSON.into()),
        raw_report: Some(raw.into()),
        map_json: Some(MAP.into()),
        remembered_json: Some("[]".into()),
        ..Default::default()
    };
    validate_orders_request(&mut ReportCache::new(), &request)
        .diagnostics
        .into_iter()
        .filter(|diagnostic| diagnostic.code == "not-enough-silver")
        .map(|diagnostic| diagnostic.message)
        .collect()
}

#[test]
fn a_walker_refused_by_the_ocean_ends_the_month_where_it_stood() {
    assert_eq!(month_end_of_4333("MOVE SE"), None);
    assert_eq!(
        month_end_of_4333("MOVE SW"),
        Some(Coordinate { x: 36, y: 42, z: 1 }),
        "the control: a step onto land does take it away"
    );
}

#[test]
fn a_walker_refused_by_the_ocean_still_pays_for_its_neighbours_study() {
    let short = shortfalls_with_4333_ordered("MOVE SE");
    assert!(
        short.is_empty(),
        "4333 stays on (37,41) and shares: {short:?}"
    );
}

/// The control: a move onto land does take 4333 and its silver away, leaving 8551 short.
#[test]
fn a_walker_that_does_leave_takes_its_silver_with_it() {
    assert_eq!(
        shortfalls_with_4333_ordered("MOVE SW"),
        ["short $10: this unit can have $0 and its orders spend $10, so its STUDY is refused"]
    );
}
