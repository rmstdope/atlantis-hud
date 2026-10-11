//! `ah-5maa`. An ENTER of a structure the hex does not have is refused, so the preview keeps the
//! unit where it was and the order carries a warning.
//!
//! `newage trident rules/enter`: *"The order will only work if the target object is unoccupied, or
//! is owned by a unit in your faction, or is owned by a faction which has declared you Friendly."*
//! An object the region does not have is none of those: the engine's `Do1EnterOrder` finds no
//! object, reports "ENTER: Can't enter that." and returns before `MoveUnit`, so the unit is not
//! moved at all - not even out of the structure it was in. `rules/sequenceofevents` runs ENTER
//! orders before any movement, so a fleet sailing in later that month cannot be entered by one.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, OrdersPreviewResponse,
};
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::OrderValidationResult;

const CODE: &str = "enter-not-here";

/// A hex with a Fort [12] holding Walker (900), and Bystander (901) outside it.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "+ Odds and Ends [12] : Fort.",
        "  * Walker (900), Foo (1), behind, leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
        "* Bystander (901), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

fn validate(orders: &str) -> OrderValidationResult {
    validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: orders.to_string(),
            ruleset_json: Some(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON.to_string()),
            raw_report: Some(report()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some("[]".to_string()),
        },
    )
}

fn preview(orders: &str) -> OrdersPreviewResponse {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &report(),
        "[]",
        orders,
    )
    .expect("the Trident ruleset loads")
}

/// `(message, 1-based line)` of each finding under [`CODE`].
fn findings(result: &OrderValidationResult) -> Vec<(String, Option<usize>)> {
    result
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == CODE)
        .map(|diagnostic| (diagnostic.message.clone(), diagnostic.line_start))
        .collect()
}

/// Where the preview puts `unit`, or `reported` when the preview has no row for it (nothing about
/// it changed).
fn structure_of(
    response: &OrdersPreviewResponse,
    unit: &str,
    reported: Option<&str>,
) -> Option<String> {
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|row| row.unit.unit_id == unit)
        .map_or(reported.map(str::to_string), |row| {
            row.unit.structure_id.clone()
        })
}

#[test]
fn an_enter_of_a_structure_the_hex_does_not_have_is_warned_on_its_line() {
    let result = validate("#atlantis 1\nunit 901\nENTER 99\n#end\n");

    let found = findings(&result);
    assert_eq!(found.len(), 1, "{:?}", result.diagnostics);
    let (message, line) = &found[0];
    assert_eq!(*line, Some(3), "on the ENTER line");
    assert!(message.contains("[99]"), "names the structure: {message}");
}

#[test]
fn an_enter_of_a_structure_the_hex_has_is_not_warned() {
    let result = validate("#atlantis 1\nunit 901\nENTER 12\n#end\n");

    assert!(findings(&result).is_empty(), "{:?}", result.diagnostics);
}

#[test]
fn a_unit_outside_stays_outside_when_its_enter_is_refused() {
    let response = preview("#atlantis 1\nunit 901\nENTER 99\n#end\n");

    assert_eq!(structure_of(&response, "901", None), None);
}

#[test]
fn a_unit_inside_is_not_taken_out_by_a_refused_enter() {
    // `Do1EnterOrder` returns before `MoveUnit`: the unit never left the Fort.
    let response = preview("#atlantis 1\nunit 900\nENTER 99\n#end\n");

    assert_eq!(
        structure_of(&response, "900", Some("12")).as_deref(),
        Some("12")
    );
}

#[test]
fn an_enter_of_a_structure_the_hex_has_still_boards_it() {
    let response = preview("#atlantis 1\nunit 901\nENTER 12\n#end\n");

    assert_eq!(structure_of(&response, "901", None).as_deref(), Some("12"));
}

/// The engine keeps only a block's last ENTER (`parseorders.cpp` `ProcessEnterOrder` overwrites
/// `u->enter` on each line), so an earlier ENTER of a real structure does not rescue a refused last
/// one: the unit stays where it stood.
#[test]
fn a_refused_last_enter_is_not_rescued_by_an_earlier_one() {
    let orders = "#atlantis 1\nunit 901\nENTER 12\nENTER 99\n#end\n";

    assert_eq!(structure_of(&preview(orders), "901", None), None);
    let found = findings(&validate(orders));
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].1, Some(4), "on the ENTER 99 line");
}

/// An ENTER a later one replaces never runs, so it is not refused either: the unit boards the
/// structure the last ENTER names, and nothing is warned.
#[test]
fn an_enter_replaced_by_a_later_one_is_not_warned() {
    let orders = "#atlantis 1\nunit 901\nENTER 99\nENTER 12\n#end\n";

    assert_eq!(
        structure_of(&preview(orders), "901", None).as_deref(),
        Some("12")
    );
    let result = validate(orders);
    assert!(findings(&result).is_empty(), "{:?}", result.diagnostics);
}
