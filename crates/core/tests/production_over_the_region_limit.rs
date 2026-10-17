//! Over the faction's region limit, the refused region's production is not counted (`ah-gcrc`).
//!
//! `neworigins-3.0.0-g5-f21-t24` prints `Regions: 10 (10)` - New Origins pools taxing and trade into
//! one allowance (`rules/tablefactionpoints`: "max tax and trade regions"). Its template orders TAX
//! in eight regions and PRODUCE in three more: ocean (38,44), ocean (37,45) and swamp (35,47),
//! where Drones (11852) and (11853) produce floater hides and TRANSPORT them to Unit (8333).
//!
//! The engine records every taxed region first, in the tax phase (`../Atlantis` `runorders.cpp`,
//! `ActivityCheck(..., TAX)`), then walks the regions in its region list's order for the month's
//! production (`monthorders.cpp` `RunMonthOrders` -> `ValidProd`), refusing "PRODUCE: Faction can't
//! produce in that many regions." once the allowance is spent. The report lists regions in that
//! same order (`faction.cpp` `present_regions`), so swamp (35,47), listed after both oceans, is the
//! region refused - and the real turn 25 says exactly that, for 11852 and 11853 both.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

fn template(text: &str) -> String {
    extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template")
}

fn floa(row: &atlantis_hud_core::orders::effects::UnitPreview) -> i64 {
    row.unit
        .items
        .iter()
        .filter(|item| item.tag.eq_ignore_ascii_case("FLOA"))
        .map(|item| item.amount)
        .sum()
}

#[test]
fn the_refused_swamps_floater_hides_are_neither_produced_nor_shipped() {
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let orders = template(text);
    assert!(
        orders.contains("unit 11852\n") && orders.contains("@produce floa"),
        "the fixture still orders unit 11852 to PRODUCE FLOA"
    );
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &orders,
    )
    .expect("the committed ruleset loads");

    for producer in ["11852", "11853"] {
        if let Some(row) = common::preview_row(text, &preview, producer) {
            assert!(
                row.produced.is_empty(),
                "{producer} produces nothing in the refused swamp: {:?}",
                row.produced
            );
            assert_eq!(floa(row), 0, "{producer}: {:?}", row.unit.items);
        }
    }
    let quartermaster = common::expect_preview_row(text, &preview, "8333");
    assert_eq!(
        floa(quartermaster),
        0,
        "nothing is shipped to 8333: {:?}",
        quartermaster.unit.items
    );
}

#[test]
fn the_region_limit_warning_names_the_refused_swamp() {
    let ruleset = ruleset();
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);

    let review = review_turn(
        &parsed,
        &template(text),
        Some(&ruleset),
        CheckOptions::default(),
    );

    let warnings: Vec<_> = review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "too-many-trade-regions")
        .collect();
    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert_eq!(
        warnings[0].message,
        "PRODUCE, TAX and PILLAGE orders in 11 regions; this faction may tax and trade in 10, so \
         1 region's orders will be refused: swamp (35,47)"
    );
}
