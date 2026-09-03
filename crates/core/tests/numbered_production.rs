//! `PRODUCE [number] [item]`, held to one answer across every surface that reads it (`ah-6x5u`).
//!
//! `rules/produce` states two forms of the order: `PRODUCE [item]`, which makes "as much as
//! possible", and `PRODUCE [number] [item]`, where "the unit will attempt to produce exactly that
//! number of items; if this is not possible in one month then the order will carry over to
//! subsequent months". The number is an upper bound over the limits the unbounded form already
//! meets - the month's men, the unit's silver and materials, and the region's settled share - and
//! never a replacement for any of them.
//!
//! The order is priced twice by two pieces of code that share nothing but their inputs:
//! `semantics::produce` builds the **ITEMS** column's `produced` list and debits the materials,
//! and `forecast_unit` (`orders/silver.rs`) builds the **SILVER** column's `produced` count and
//! its cap. This fixture asks both about the same raw orders, in the style
//! `production_after_a_gift.rs` established, so the two cannot drift apart unnoticed.
//!
//! A fixture of its own rather than a case added to a real-report corpus: the cases below need a
//! unit whose men, materials and written request can each be set independently, and the committed
//! turns contain no numbered `PRODUCE` at all.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{ProductionCap, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex and one smith holding `iron` iron.
///
/// Eight orcs at `weaponsmith 1`, so eight man-months: `config/public/ruleset.json`'s
/// `skills.WEAP.produces` entry - and `rules/tableiteminfo` - make a sword one man-month and one
/// iron, so the men alone could make eight. The men must be the *first* item on the line:
/// `count_men` (`crates/core/src/report/unit.rs`) reads the headcount off `items.first()`.
///
/// A manufactured item on purpose: swords are made from iron the unit carries, which
/// `rules/sequenceofevents` runs in the manufacturing phase ahead of the primary one, so nothing
/// here contends for the hex's own yield and the request meets the unit's own limits alone.
fn report(iron: i64) -> String {
    [
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        // A holding of none is written by leaving the item off the line, which is how a report
        // states it: `0 iron [IRON]` is not a shape the game ever prints.
        format!(
            "* Smiths (900), Foo (1), behind, 8 orcs [ORC]{}. Weight: 180. \
             Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30).",
            if iron > 0 {
                format!(", {iron} iron [IRON]")
            } else {
                String::new()
            }
        ),
        String::new(),
    ]
    .join("\n")
}

fn orders_for(iron: i64, script: &str) -> String {
    let text = report(iron);
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 900\n{script}\n")
}

/// The ITEMS column's answer: how many swords unit 900 makes, and what its iron is left at.
///
/// A unit the orders leave completely unchanged is left out of the preview altogether
/// (`ah-agbm`), which is exactly what a run that makes nothing and spends nothing looks like - so
/// its absence is read as "none made, holdings untouched" rather than as a failure.
fn items_column(iron: i64, script: &str) -> (i64, i64) {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report(iron),
        "[]",
        &orders_for(iron, script),
    )
    .expect("the ruleset loads");

    let Some(unit) = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "900")
    else {
        return (0, iron);
    };

    let made = unit
        .produced
        .iter()
        .filter(|produced| produced.tag == "SWOR")
        .map(|produced| produced.amount)
        .sum();
    let iron_left = unit
        .unit
        .items
        .iter()
        .find(|item| item.tag.eq_ignore_ascii_case("IRON"))
        .map_or(0, |item| item.amount);
    (made, iron_left)
}

/// The SILVER column's whole answer for unit 900.
fn silver_column(iron: i64, script: &str) -> UnitSilver {
    let text = report(iron);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    review_turn(
        &parsed,
        &orders_for(iron, script),
        Some(&ruleset()),
        CheckOptions::default(),
    )
    .silver
    .into_iter()
    .find(|silver| silver.unit_id == "900")
    .expect("the smith is forecast")
}

/// The bead's own table, both columns of the row at once. Eight men, so eight swords is the
/// month's natural output whatever the order asks for; the message carries the case, so a future
/// divergence names itself.
#[test]
fn numbered_production_agrees_across_items_silver_and_inventory() {
    for (script, iron, made, capped) in [
        // The request is the lowest limit: three made, three iron spent, and nothing capped it.
        ("PRODUCE 3 sword", 20, 3, None),
        // More than the month's men can finish, so `rules/produce` carries the rest over.
        ("PRODUCE 10 sword", 20, 8, Some(ProductionCap::Workforce)),
        // Materials are lower than both the men and the request, so they are what bound.
        ("PRODUCE 10 sword", 5, 5, Some(ProductionCap::Materials)),
        // Nothing to work with at all: none made, and the materials are still what stopped it.
        ("PRODUCE 3 sword", 0, 0, Some(ProductionCap::Materials)),
        // The unbounded form, unchanged: everything the men can make, and no request to quote.
        ("PRODUCE sword", 20, 8, None),
    ] {
        let case = format!("`{script}` holding {iron} iron");
        let (items_made, iron_left) = items_column(iron, script);
        let silver = silver_column(iron, script);

        assert_eq!(
            items_made, made,
            "the ITEMS column for {case}: {items_made} swords, expected {made}"
        );
        assert_eq!(
            iron_left,
            iron - made,
            "the projected iron for {case}: {iron_left} left of {iron}"
        );
        assert_eq!(
            silver.produced, made,
            "the SILVER column for {case}: {} swords, expected {made}",
            silver.produced
        );
        assert_eq!(
            silver.production_requested,
            script
                .split_whitespace()
                .nth(1)
                .and_then(|token| token.parse::<i64>().ok()),
            "the request quoted back for {case}"
        );
        assert_eq!(
            silver.production_wanted, 8,
            "the men's own output for {case} is what the unnumbered wording quotes"
        );
        assert_eq!(
            silver.production_capped_by, capped,
            "what bound {case}: {:?}, expected {capped:?}",
            silver.production_capped_by
        );
    }
}
