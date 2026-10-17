//! Cooking's output, on both surfaces that read a `PRODUCE` (`ah-opzd`).
//!
//! The data pages state cooking's output as a formula of the cook's level rather than a fixed
//! rate, and differently per world:
//!
//! - `newage arcanum data/COOK`: "may PRODUCE a number of meals [MEAL] equal to their skill level
//!   from any of grain [GRAI], livestock [LIVE] and fish [FISH] at a rate of 1 per man-month".
//! - `data/COOK` (New Origins): "equal to skill level divided by 2, rounded up".
//!
//! The engine (`monthorders.cpp`, `RunUnitProduce`, for an item flagged `SKILLOUT` /
//! `SKILLOUT_HALF` with `ORINPUTS`) makes one batch per man, each batch eating one of the
//! alternative inputs, taken in the order the recipe lists them, and each batch yielding that many
//! meals. Before this bead the ruleset carried `outputs: null` for cooking and `plan_production`
//! refused alternative inputs, so every cook showed Silver "?" and an uncounted meal total.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{ProductionCap, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The ITEMS column's meals for one unit, and that unit's projected holding of each tag in `tags`.
fn items_column(
    ruleset_json: &str,
    report: &str,
    orders: &str,
    unit: &str,
    tags: &[&str],
) -> (i64, Vec<i64>) {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset_json,
        report,
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    let Some(preview) = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|preview| preview.unit.unit_id == unit)
    else {
        panic!("unit {unit} is in the preview");
    };
    let made = preview
        .produced
        .iter()
        .filter(|produced| produced.tag == "MEAL")
        .map(|produced| produced.amount)
        .sum();
    let held = tags
        .iter()
        .map(|tag| {
            preview
                .unit
                .items
                .iter()
                .find(|item| item.tag.eq_ignore_ascii_case(tag))
                .map_or(0, |item| item.amount)
        })
        .collect();
    (made, held)
}

fn silver_column(ruleset: &Ruleset, report: &str, orders: &str, unit: &str) -> UnitSilver {
    let mut parsed = parse_report_full(report);
    classify_units(&mut parsed, ruleset);
    review_turn(&parsed, orders, Some(ruleset), CheckOptions::default())
        .silver
        .into_iter()
        .find(|silver| silver.unit_id == unit)
        .expect("the cook is forecast")
}

/// The bead's own case: Unit (184) in `newage-arcanum-f3-t84`, 30 humans at `cooking 4`, its
/// template's `@produce "meals"` untouched. The next turn's events say "Unit (184): Produces 120
/// meals [MEAL]" - 30 men times level 4.
#[test]
fn an_arcanum_cook_makes_its_level_in_meals_per_man_and_its_silver_is_counted() {
    let raw = atlantis_hud_fixtures::NEWAGE_ARCANUM_F3_T84.text;
    let ruleset = Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON)
        .expect("the committed Arcanum ruleset loads");
    let template = extract_orders_template(raw)
        .expect("the report carries a template")
        .text;

    let silver = silver_column(&ruleset, raw, &template, "184");
    assert_eq!(silver.doubt, None, "184's silver is counted: {silver:?}");
    assert!(
        silver.at_month_end.is_some(),
        "184's month end is a figure: {silver:?}"
    );
    assert_eq!(silver.produced, 120, "184 makes 30 x 4 meals: {silver:?}");

    let (made, _) = items_column(
        atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON,
        raw,
        &template,
        "184",
        &[],
    );
    assert_eq!(made, 120, "the ITEMS column shows 120 meals for 184");
}

/// One New Origins cook: five orcs at `cooking 3`, holding `grain` grain and `fish` fish, and
/// silver enough for their upkeep - without it they would eat a fish, which is not this bead's.
fn new_origins_cook(grain: i64, fish: i64) -> String {
    let mut held = ", 500 silver [SILV]".to_string();
    if grain > 0 {
        held.push_str(&format!(", {grain} grain [GRAI]"));
    }
    if fish > 0 {
        held.push_str(&format!(", {fish} fish [FISH]"));
    }
    [
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        format!(
            "* Cooks (900), Foo (1), behind, 5 orcs [ORC]{held}. Weight: 50. \
             Capacity: 0/0/75/0. Skills: cooking [COOK] 3 (180)."
        ),
        String::new(),
    ]
    .join("\n")
}

/// `data/COOK`'s New Origins formula, level 3 divided by 2 and rounded up, is two meals per man;
/// the alternatives are drawn in the recipe's order, grain before livestock before fish.
#[test]
fn a_new_origins_cook_makes_half_its_level_rounded_up_per_man() {
    for (grain, fish, made, grain_left, fish_left, capped) in [
        // Five men, five batches: the two grain go first, then three fish.
        (2, 10, 10, 0, 7, None),
        // Three inputs between them, so three batches: the materials are what stopped it.
        (1, 2, 6, 0, 0, Some(ProductionCap::Materials)),
    ] {
        let case = format!("holding {grain} grain and {fish} fish");
        let report = new_origins_cook(grain, fish);
        let template = extract_orders_template(&report)
            .map(|template| template.text)
            .unwrap_or_default();
        let orders = format!("{template}\nunit 900\nPRODUCE meals\n");

        let silver = silver_column(&ruleset(), &report, &orders, "900");
        assert_eq!(silver.doubt, None, "{case}: silver is counted: {silver:?}");
        assert_eq!(silver.produced, made, "{case}: SILVER column's meals");
        assert_eq!(silver.production_capped_by, capped, "{case}: the cap");

        let (items_made, held) = items_column(
            atlantis_hud_fixtures::RULESET_JSON,
            &report,
            &orders,
            "900",
            &["GRAI", "FISH"],
        );
        assert_eq!(items_made, made, "{case}: ITEMS column's meals");
        assert_eq!(
            held,
            vec![grain_left, fish_left],
            "{case}: grain and fish left"
        );
    }
}
