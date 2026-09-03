//! Production sees the settled market, regardless of text order.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "  For Sale: 20 orcs [ORC] at $10.",
        "  Wanted: 20 iron [IRON] at $10.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON], 200 silver [SILV]. \
         Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
        "",
    ]
    .join("\n")
}

fn orders_for(script: &str) -> String {
    let template = extract_orders_template(&report())
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 900\n{script}\n")
}

fn produced(script: &str) -> (i64, i64, Vec<String>) {
    let text = report();
    let orders = orders_for(script);
    let items = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &orders,
    )
    .expect("the ruleset loads")
    .regions
    .iter()
    .flat_map(|region| region.units.iter())
    .find(|unit| unit.unit.unit_id == "900")
    .map_or(0, |unit| {
        unit.produced
            .iter()
            .filter(|item| item.tag == "SWOR")
            .map(|item| item.amount)
            .sum()
    });

    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());
    let review = review_turn(&parsed, &orders, Some(&ruleset()), CheckOptions::default());
    let silver = review
        .silver
        .iter()
        .find(|unit| unit.unit_id == "900")
        .map_or(0, |unit| unit.produced);
    let findings = review
        .findings
        .iter()
        .filter(|finding| finding.unit_id.as_deref() == Some("900"))
        .map(|finding| finding.code.as_str().to_string())
        .collect();

    (items, silver, findings)
}

#[test]
fn buy_and_sell_settle_before_produce_in_either_text_order() {
    for (market, expected) in [
        ("BUY 4 ORC", 0),
        ("BUY 8 ORC", 0),
        ("SELL 5 IRON", 8),
        ("SELL ALL IRON", 0),
    ] {
        for script in [
            format!("{market}\nPRODUCE SWOR"),
            format!("PRODUCE SWOR\n{market}"),
        ] {
            let (items, silver, findings) = produced(&script);
            assert_eq!(items, expected, "ITEMS for `{script}`");
            assert_eq!(silver, expected, "SILVER for `{script}`");
            assert!(
                !findings.iter().any(|code| code == "not-enough-items"),
                "no item shortfall for `{script}`: {findings:?}"
            );
        }
    }
}
