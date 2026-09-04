//! A `GIVE ... ALL SILV` hands over the silver its unit holds **when the Give phase runs**, and the
//! tax it collects afterwards stays with it (`ah-tc79`).
//!
//! `rules/sequenceofevents` settles *Give orders* ("GIVE and TAKE orders are ...") before *Tax
//! orders* ("TAX orders are processed."), so a unit that both taxes and gives its whole purse away
//! gives away only what it opened with.
//!
//! Both surfaces are read, because they are independently computed and are held to each other: the
//! SILVER column through `review_turn`, and the ITEMS projection through
//! `preview_orders_for_remembered_report`. The ledger behind the projection already reads the phase
//! order correctly, which is what makes it the oracle here rather than a second assertion of the
//! same code.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex whose tax base is $500, a taxing unit holding 100 silver, and a neighbour to give to.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`. The `combat [COMB] 1` skill is load-bearing - it is what makes all ten men
/// taxers, so the tax is priced rather than doubted.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $500.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Taxers (900), Foo (1), 10 orcs [ORC], 100 silver [SILV]. Weight: 100. \
         Capacity: 0/0/150/0. Skills: combat [COMB] 1 (30).",
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

/// The two document orders the answer must not depend on.
const SCRIPTS: [&str; 2] = ["TAX\nGIVE 901 ALL SILV", "GIVE 901 ALL SILV\nTAX"];

#[test]
fn the_silver_column_gives_only_what_the_unit_holds_before_it_taxes() {
    for script in SCRIPTS {
        let text = report();
        let mut parsed = parse_report_full(&text);
        classify_units(&mut parsed, &ruleset());

        let review = review_turn(
            &parsed,
            &orders_for(script),
            Some(&ruleset()),
            CheckOptions::default(),
        );

        let silver = review
            .silver
            .iter()
            .find(|silver| silver.unit_id == "900")
            .unwrap_or_else(|| panic!("{script:?}: the silver column has a row for the taxer"));

        assert_eq!(silver.doubt, None, "{script:?}: the month is priced");
        assert_eq!(silver.income, Some(500), "{script:?}: the tax take");
        assert_eq!(
            silver.expense,
            Some(100),
            "{script:?}: only the silver held before the tax phase is given"
        );
        assert_eq!(
            silver.at_month_end,
            Some(500),
            "{script:?}: what the tax brought in stays"
        );
    }
}

#[test]
fn the_item_projection_and_the_receivers_row_agree_with_it() {
    for script in SCRIPTS {
        let preview = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            atlantis_hud_fixtures::RULESET_JSON,
            &report(),
            "[]",
            &orders_for(script),
        )
        .expect("the ruleset loads");

        let silver_of = |unit_id: &str| -> i64 {
            preview
                .regions
                .iter()
                .flat_map(|region| region.units.iter())
                .find(|unit| unit.unit.unit_id == unit_id)
                .unwrap_or_else(|| panic!("{script:?}: the preview has unit {unit_id}"))
                .unit
                .items
                .iter()
                .filter(|item| item.tag == "SILV")
                .map(|item| item.amount)
                .sum()
        };

        assert_eq!(
            silver_of("901"),
            100,
            "{script:?}: the receiver gets what the giver held, not what it later taxed"
        );
        // The projection counts what the *orders* move, and a tax credit is not an item change it
        // models - so the giver is down by the gift alone. What matters here is the size of that
        // gift: 100, not the 600 the column used to make of it.
        assert_eq!(
            silver_of("900"),
            0,
            "{script:?}: the giver is down exactly the 100 it held"
        );
    }
}
