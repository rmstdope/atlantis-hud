//! `common::preview_row` tells a unit the orders leave alone apart from a unit the fixture does
//! not have at all (`ah-z9g8`).

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, OrdersPreviewResponse,
};

mod common;
use common::{expect_preview_row, preview_row};

/// The smiths (900) hold 500 silver; the hands (901) hold none.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON], 500 silver [SILV]. Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
        "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

fn preview(text: &str, orders: &str) -> OrdersPreviewResponse {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        orders,
    )
    .expect("the committed ruleset loads")
}

#[test]
fn a_unit_the_orders_leave_alone_has_no_row() {
    let text = report_text();
    assert_eq!(
        ReportCache::new()
            .classified(&text, atlantis_hud_fixtures::RULESET_JSON)
            .own_units()
            .count(),
        2
    );

    let response = preview(&text, "unit 900\nGIVE 901 100 SILV\n");
    assert!(preview_row(&text, &response, "901").is_some());

    let response = preview(&text, "unit 900\n");
    assert!(preview_row(&text, &response, "901").is_none());
}

#[test]
fn a_unit_the_orders_change_is_found() {
    let text = report_text();
    let response = preview(&text, "unit 900\nGIVE 901 100 SILV\n");
    assert_eq!(
        expect_preview_row(&text, &response, "900").unit.unit_id,
        "900"
    );
}

#[test]
#[should_panic(expected = "has no preview row")]
fn an_unchanged_unit_fails_the_expecting_lookup_as_unchanged() {
    let text = report_text();
    let response = preview(&text, "unit 900\n");
    expect_preview_row(&text, &response, "900");
}

#[test]
#[should_panic(expected = "is not an own unit of the fixture report")]
fn a_unit_the_fixture_does_not_have_fails_as_a_broken_fixture() {
    let text = report_text();
    let response = preview(&text, "unit 900\n");
    preview_row(&text, &response, "2390");
}
