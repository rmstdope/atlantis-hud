//! A `GIVE ... ALL SILV` hands over the silver its unit holds **when the Give phase runs**, and a
//! study charged in the turn's last block does not make the gift smaller (`ah-a5ci`).
//!
//! `rules/sequenceofevents` settles *Give orders* ("GIVE and TAKE orders are processed.") second and
//! *Month long orders* ("STUDY orders are processed.") last, so a unit that gives its whole purse
//! away and studies gives away the whole purse and is then short for the study.
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

/// One hex, a studying unit of ten men holding 100 silver, and a neighbour to give to.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`. No skill line is needed - a study is priced from the *skill's* cost per man,
/// not from what the unit already knows.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $500.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Students (900), Foo (1), 10 orcs [ORC], 100 silver [SILV]. Weight: 100. \
         Capacity: 0/0/150/0.",
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
const SCRIPTS: [&str; 2] = [
    "STUDY COMB\nGIVE 901 ALL SILV",
    "GIVE 901 ALL SILV\nSTUDY COMB",
];

#[test]
fn the_silver_column_gives_the_whole_purse_and_says_the_study_is_short() {
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
            .unwrap_or_else(|| panic!("{script:?}: the silver column has a row for the student"));

        assert_eq!(silver.doubt, None, "{script:?}: the month is priced");
        assert_eq!(silver.income, Some(0), "{script:?}: nothing comes in");
        assert_eq!(
            silver.expense,
            Some(200),
            "{script:?}: 100 given away and 100 studied"
        );
        assert_eq!(
            silver.at_month_end,
            Some(-100),
            "{script:?}: the study is unpaid for"
        );
        assert_eq!(
            silver.short_for_orders,
            Some(100),
            "{script:?}: and that is what the shortfall says"
        );

        let received = review
            .silver
            .iter()
            .find(|silver| silver.unit_id == "901")
            .unwrap_or_else(|| panic!("{script:?}: the silver column has a row for the receiver"));
        assert_eq!(
            received.income,
            Some(100),
            "{script:?}: the receiver is credited the whole purse"
        );
    }
}

#[test]
fn the_item_projection_agrees_about_the_size_of_the_gift() {
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
            "{script:?}: the receiver gets the whole purse the giver held"
        );
        assert_eq!(
            silver_of("900"),
            0,
            "{script:?}: and the giver keeps none of it"
        );
    }
}
