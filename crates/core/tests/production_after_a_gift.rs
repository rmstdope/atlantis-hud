//! The two production figures on one row, held to each other when the month's gifts move men or
//! materials (`ah-qct4`).
//!
//! A `PRODUCE` order is priced twice from the same orders by two pieces of code that share nothing
//! but their inputs: `semantics::produce` builds the **ITEMS** column's `produced` list, and
//! `forecast_unit` (`orders/silver.rs`) builds the **SILVER** column's `produced` count. They had
//! drifted - the ledger priced the run off the report's own headcount and item list while the
//! forecast priced it off the picture this month's `GIVE`/`TAKE` leaves behind - so one half of a
//! row credited a unit eight swords while the other half of the same row said none.
//!
//! `rules/sequenceofevents` settles *"Give orders. GIVE and TAKE orders are processed."* nine
//! phases before *"Primary PRODUCE orders ... are processed"*, so the post-gift picture is the
//! right one and both surfaces now read it.
//!
//! A fixture of its own rather than an assertion added to `silver_agrees_with_the_warning.rs`'s
//! corpus walk: the two surfaces still differ for a unit that buys or sells men in the same month
//! (the ledger cannot see the market during its own intent loop), so a corpus-wide assertion would
//! be red for a reason this bead does not fix.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex, a smith with men and iron, and a neighbour to give to.
///
/// The men must be the *first* item on each own unit's line: `count_men`
/// (`crates/core/src/report/unit.rs`) reads the headcount off `items.first()`. The smith has no
/// skills, exactly as `effects.rs`'s own fixture family does, so every case here also raises
/// `produce-without-skill` - expected, and it moves no figure.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Smiths (900), Foo (1), behind, 8 orcs [ORC], 20 iron [IRON]. Weight: 180. \
         Capacity: 0/0/120/0.",
        "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

fn orders_for(script: &str) -> String {
    let text = report();
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 900\n{script}\n")
}

/// The ITEMS column's answer: how many of `tag` unit 900's `PRODUCE` makes this month.
fn items_column_produced(script: &str, tag: &str) -> i64 {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report(),
        "[]",
        &orders_for(script),
    )
    .expect("the ruleset loads");

    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "900")
        .map_or(0, |unit| {
            unit.produced
                .iter()
                .filter(|produced| produced.tag == tag)
                .map(|produced| produced.amount)
                .sum()
        })
}

/// The SILVER column's answer, and every finding the same review raised for unit 900.
fn silver_column_produced(script: &str) -> (i64, Vec<String>) {
    let text = report();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset());

    let review = review_turn(
        &parsed,
        &orders_for(script),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    let produced = review
        .silver
        .iter()
        .find(|silver| silver.unit_id == "900")
        .map_or(0, |silver| silver.produced);
    let codes = review
        .findings
        .iter()
        .filter(|finding| finding.unit_id.as_deref() == Some("900"))
        .map(|finding| finding.code.as_str().to_string())
        .collect();

    (produced, codes)
}

/// The navigator's Q7·A, pinned because it will look like a regression to anyone who does not know
/// it was chosen: the unit is not short of iron, it gave the iron away and simply makes nothing.
#[test]
fn giving_the_materials_away_is_not_a_shortfall() {
    let (_, codes) = silver_column_produced("GIVE 901 ALL IRON\nPRODUCE sword");

    assert!(
        !codes.iter().any(|code| code == "not-enough-items"),
        "no shortfall for iron that was given away, not overspent: {codes:?}"
    );

    // And the partial case, which is the one a cap could still get wrong.
    let (_, codes) = silver_column_produced("GIVE 901 15 IRON\nPRODUCE sword");
    assert!(
        !codes.iter().any(|code| code == "not-enough-items"),
        "five swords are exactly what five iron buy: {codes:?}"
    );
}

/// Every case in the bead's own table, both halves of the row at once. The message carries the
/// script and both numbers, so a future divergence names itself.
#[test]
fn the_two_columns_agree_about_production_when_a_gift_moves_men_or_materials() {
    for (script, expected) in [
        ("PRODUCE sword", 8),
        ("GIVE 901 ALL MEN\nPRODUCE sword", 0),
        ("GIVE 901 ALL ORCS\nPRODUCE sword", 0),
        ("GIVE 901 ALL ITEMS\nPRODUCE sword", 0),
        ("GIVE 901 ALL IRON\nPRODUCE sword", 0),
        ("GIVE 901 15 IRON\nPRODUCE sword", 5),
        ("GIVE 901 4 ORC\nPRODUCE sword", 4),
    ] {
        let items = items_column_produced(script, "SWOR");
        let (silver, _) = silver_column_produced(script);

        assert_eq!(
            items, expected,
            "the ITEMS column for `{script}`: {items} swords, expected {expected}"
        );
        assert_eq!(
            silver, expected,
            "the SILVER column for `{script}`: {silver} swords, expected {expected}"
        );
    }
}
