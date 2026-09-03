//! What manufacturing has to work with is what the market leaves behind (`ah-l80z`).
//!
//! `rules/sequenceofevents` puts *"SELL orders are processed"* and *"BUY orders are processed"*
//! under **Market orders**, and *"Manufacturing PRODUCE orders (those that produce items from
//! other items, such as using the weaponsmith skill to make swords out of iron)"* eleven entries
//! later, after STUDY. So iron bought this month is iron a sword can be made from, and iron sold
//! this month is not - whichever way round the two orders are written in the document.
//!
//! Both surfaces are held to that here: the **ITEMS** preview (`semantics::produce`) and the
//! **SILVER** forecast (`forecast_unit`), which price the same order twice and must agree.
//!
//! `data/WEAP` is the recipe: weaponsmith 1 makes one sword [SWOR] from one iron [IRON] at one per
//! man-month, and no silver. Eight orcs at level 1 are eight man-months, so every row below is
//! capped by iron and never by men.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One region, one smith, and a market that both buys and sells iron at **$1**. The smith starts
/// with **$100**, which is what makes every silver figure below checkable by hand.
///
/// The men must be the *first* item on the unit's line: `count_men`
/// (`crates/core/src/report/unit.rs`) reads the headcount off `items.first()`. An iron of 0 is
/// omitted from the line entirely, exactly as the report omits an empty stock.
fn report(iron: i64) -> String {
    let held = if iron > 0 {
        format!(", {iron} iron [IRON]")
    } else {
        String::new()
    };
    [
        "Atlantis Report For:".to_string(),
        "The Smiths (1)".to_string(),
        "February, Year 1".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        "------------------------------------------------------------".to_string(),
        "  Wages: $13.5 (Max: $633).".to_string(),
        "  Wanted: 20 iron [IRON] at $1.".to_string(),
        "  For Sale: 20 iron [IRON] at $1.".to_string(),
        "  Entertainment available: $85.".to_string(),
        "  Products: none.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        format!(
            "* Smiths (900), The Smiths (1), behind, 8 orcs [ORC]{held}, 100 silver [SILV]. \
             Weight: 180. Capacity: 0/0/120/0. Skills: weaponsmith [WEAP] 1 (30)."
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

/// The ITEMS preview's answer: how many swords unit 900 makes, and what iron it is left holding.
fn items_column(iron: i64, script: &str) -> (i64, i64) {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report(iron),
        "[]",
        &orders_for(iron, script),
    )
    .expect("the ruleset loads");

    let unit = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "900")
        .expect("unit 900 is previewed");

    let swords = unit
        .produced
        .iter()
        .filter(|produced| produced.tag.eq_ignore_ascii_case("SWOR"))
        .map(|produced| produced.amount)
        .sum();
    let iron_left = unit
        .unit
        .items
        .iter()
        .find(|item| item.tag.eq_ignore_ascii_case("IRON"))
        .map_or(0, |item| item.amount);

    (swords, iron_left)
}

/// The SILVER forecast's answer for unit 900, and every finding the same review raised for it.
struct SilverRow {
    produced: i64,
    income: Option<i64>,
    expense: Option<i64>,
    at_month_end: Option<i64>,
    codes: Vec<String>,
}

fn silver_column(iron: i64, script: &str) -> SilverRow {
    let text = report(iron);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    let review = review_turn(
        &parsed,
        &orders_for(iron, script),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    let silver = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .expect("unit 900 is forecast");

    SilverRow {
        produced: silver.produced,
        income: silver.income,
        expense: silver.expense,
        at_month_end: silver.at_month_end,
        codes: review
            .findings
            .iter()
            .filter(|finding| finding.unit_id.as_deref() == Some("900"))
            .map(|finding| finding.code.as_str().to_string())
            .collect(),
    }
}

/// One expected row of the bead's table.
struct Expected {
    iron: i64,
    market: &'static str,
    swords: i64,
    iron_left: i64,
    income: i64,
    expense: i64,
    at_month_end: i64,
}

/// Every row, in both text orders: the market line above `PRODUCE sword`, and below it. Both
/// orders must give the same answer - that is what proves phase order beats document order.
#[test]
fn market_trades_set_the_materials_for_manufacturing_in_every_projection() {
    for expected in [
        Expected {
            iron: 0,
            market: "BUY 8 IRON",
            swords: 8,
            iron_left: 0,
            income: 0,
            expense: 8,
            at_month_end: 92,
        },
        Expected {
            iron: 20,
            market: "SELL 15 IRON",
            swords: 5,
            iron_left: 0,
            income: 15,
            expense: 0,
            at_month_end: 115,
        },
        Expected {
            iron: 20,
            market: "SELL ALL IRON",
            swords: 0,
            iron_left: 0,
            income: 20,
            expense: 0,
            at_month_end: 120,
        },
        // The control: a unit that trades nothing must be unaffected.
        Expected {
            iron: 20,
            market: "",
            swords: 8,
            iron_left: 12,
            income: 0,
            expense: 0,
            at_month_end: 100,
        },
    ] {
        let scripts: Vec<String> = if expected.market.is_empty() {
            vec!["PRODUCE sword".to_string()]
        } else {
            vec![
                format!("{}\nPRODUCE sword", expected.market),
                format!("PRODUCE sword\n{}", expected.market),
            ]
        };

        for script in scripts {
            let (swords, iron_left) = items_column(expected.iron, &script);
            assert_eq!(
                swords, expected.swords,
                "the ITEMS column's swords for `{script}` from {} iron",
                expected.iron
            );
            assert_eq!(
                iron_left, expected.iron_left,
                "the ITEMS column's iron left for `{script}` from {} iron",
                expected.iron
            );

            let row = silver_column(expected.iron, &script);
            assert_eq!(
                row.produced, expected.swords,
                "the SILVER column's swords for `{script}` from {} iron",
                expected.iron
            );
            assert_eq!(
                row.income,
                Some(expected.income),
                "income for `{script}` from {} iron",
                expected.iron
            );
            assert_eq!(
                row.expense,
                Some(expected.expense),
                "expense for `{script}` from {} iron",
                expected.iron
            );
            assert_eq!(
                row.at_month_end,
                Some(expected.at_month_end),
                "silver at month end for `{script}` from {} iron",
                expected.iron
            );
            assert!(
                !row.codes
                    .iter()
                    .any(|code| code == "not-enough-items" || code == "not-enough-silver"),
                "no shortfall for `{script}` from {} iron: {:?}",
                expected.iron,
                row.codes
            );
        }
    }
}
