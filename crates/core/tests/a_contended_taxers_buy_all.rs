//! A `BUY ALL` by a unit whose share of a contended regional tax pool is smaller than the pool is
//! sized by that **settled share**, on both surfaces, from one figure (`ah-ud89.2`).
//!
//! `rules/economy_taxingpillaging`: *"Each taxing character can collect $50, though if the number
//! of taxers would tax more than the available tax income, the tax income is split evenly among
//! all taxers."* Two ten-orc taxers each want `10 * 50 = $500`, so any pool below $1000 is
//! oversubscribed and each collects half of it.
//!
//! `rules/buy`: *"If the unit can't afford as many as [quantity], it will attempt to buy as many as
//! it can."* `data/GRAI` is the goods throughout and `data/COMB` prices a month of combat study at
//! 10 silver per man; `rules/sequenceofevents` fixes which phases run before *"Market orders"*.
//!
//! Before this bead the `BUY ALL` cap read the region's **whole** pool while the Silver column
//! showed only the settled share, so the unit was shown buying goods the game would refuse it.
//!
//! Both surfaces are read per fixture, because they are independently computed and are held to
//! each other: the SILVER column through `review_turn`, the ITEMS column through
//! `preview_orders_for_remembered_report`.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{codes, review_turn, CheckOptions, Finding};
use atlantis_hud_core::orders::silver::{BuyAllCap, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex whose region states a tax base of `pool`, one market line, and the named own units.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`.
fn report(pool: i64, for_sale: &str, units: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        format!("plain (1,1) in Nowhere, 1000 peasants (orcs), ${pool}."),
        format!("  For Sale: {for_sale}"),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
    ];
    lines.extend(units.iter().map(|unit| (*unit).to_string()));
    lines.push(String::new());
    lines.join("\n")
}

fn taxer(id: &str, name: &str) -> String {
    format!(
        "* {name} ({id}), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
         Skills: combat [COMB] 1 (30)."
    )
}

/// The unit's SILVER row, how many of `tag` the ITEMS preview leaves it holding, and every finding
/// the review raised.
fn both_surfaces(
    text: &str,
    script: &str,
    unit_id: &str,
    tag: &str,
) -> (UnitSilver, i64, Vec<Finding>) {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\n{script}");

    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
    let row = review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .expect("the column has a row for the unit")
        .clone();

    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &orders,
    )
    .expect("the committed ruleset loads");
    // A unit the preview has nothing to say about is **absent** from it rather than present with a
    // zero (`ah-ud89.1`), so sum over a filter rather than `expect`ing a `find`.
    let held: i64 = preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.unit.unit_id == unit_id)
        .flat_map(|unit| unit.unit.items.iter())
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum();

    (row, held, review.findings.clone())
}

/// Fixture A: a $200 pool, two ten-orc taxers, grain at $10. 900 settles at $100 and buys ten -
/// not the twenty the whole pool would pay for - and the ITEMS surface says the same. The control
/// in the same test leaves 901 untaxing, so 900 is uncontended and keeps its twenty.
#[test]
fn a_contended_taxer_buys_what_its_share_pays_for() {
    let text = report(
        200,
        "50 grain [GRAI] at $10.",
        &[&taxer("900", "Buyers"), &taxer("901", "Guards")],
    );
    let (row, held, _) = both_surfaces(
        &text,
        "unit 900\nTAX\nBUY ALL grain\nunit 901\nTAX\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.buy_all.len(), 1);
    assert_eq!(
        row.buy_all[0].bought, 10,
        "the settled half of the pool pays for ten at $10"
    );
    assert_eq!(row.buy_all[0].capped_by, BuyAllCap::Silver);
    assert_eq!(held, 10, "and the ITEMS ledger says the same");
    assert_eq!(row.income, Some(100), "the settled share of a $200 pool");
    assert_eq!(row.at_month_end, Some(0), "spent on the grain it bought");

    // The control: an uncontended taxer is untouched by this bead.
    let (alone, alone_held, _) =
        both_surfaces(&text, "unit 900\nTAX\nBUY ALL grain\n", "900", "GRAI");
    assert_eq!(alone.income, Some(200), "nobody contends for the pool");
    assert_eq!(alone.buy_all[0].bought, 20);
    assert_eq!(alone_held, 20);
    assert_eq!(alone.at_month_end, Some(0));
}

/// Fixture B: the purse the hover quotes. `buyAllSentences` says *"it can have N silver"* straight
/// out of `silver_available`, so that figure must be the settled purse - 50, not the pooled 100.
#[test]
fn a_contended_taxer_that_can_afford_none_reports_its_settled_purse() {
    let text = report(
        100,
        "50 grain [GRAI] at $60.",
        &[&taxer("900", "Buyers"), &taxer("901", "Guards")],
    );
    let (row, _, _) = both_surfaces(
        &text,
        "unit 900\nTAX\nBUY ALL grain\nunit 901\nTAX\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.buy_all.len(), 1);
    assert_eq!(row.buy_all[0].bought, 0, "50 silver buys none at $60");
    assert_eq!(row.buy_all[0].capped_by, BuyAllCap::Silver);
    assert_eq!(
        row.buy_all[0].silver_available, 50,
        "the settled purse, which is what the hover quotes; 100 would mean the ledger's pooled \
         reading still reaches the sentence"
    );
}

/// Fixture C: the `not-enough-silver` that the plan expected to go quiet, and why it never fires
/// here either way.
///
/// The navigator's round-4 answer `W1` (`ah-ud89.2`'s *User-facing decisions*) accepted that a
/// smaller settled purchase leaves more in the **hopeful** ledger balance every
/// `not-enough-silver` reads, so a unit warned about today could go unwarned. **For a `BUY ALL`
/// that decision costs nothing**, and this test is where that is written down: a `BUY ALL` is
/// sized by the purse it is about to spend, so it can never overdraw the hopeful balance whatever
/// the cap reads - before this bead the hopeful 200 bought exactly 200's worth, after it the
/// settled 100 buys 100's worth, and neither leaves the ledger short. Measured both ways on this
/// tree.
///
/// The plan's own fixture C added `STUDY combat` to make the shortfall, which cannot work:
/// measured on this tree, that unit's income is then `0` - `taxing_men` counts no man of a unit
/// whose `readiness` is zero (`silver.rs:3896`) - so there is no contended share left to settle
/// and both readings of the cap agree at nothing. `CAST` is not in that position, which is why
/// `ah-ud89.1`'s fixtures could use it.
///
/// The hex has no sharer, so the per-unit `not-enough-silver` arm is the right one to read: in a
/// hex where anyone `SHARE`s the finding is emitted hex-wide with no `unit_id` at all.
#[test]
fn a_smaller_settled_purchase_moves_no_shortfall_warning() {
    let text = report(
        200,
        "50 grain [GRAI] at $10.",
        &[&taxer("900", "Buyers"), &taxer("901", "Guards")],
    );
    let (row, held, findings) = both_surfaces(
        &text,
        "unit 900\nTAX\nBUY ALL grain\nunit 901\nTAX\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.buy_all[0].bought, 10);
    assert_eq!(held, 10);
    assert!(
        !findings
            .iter()
            .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER),
        "a silver-capped BUY ALL cannot overdraw the hopeful balance, so `W1` does not bite here"
    );
    assert!(
        findings
            .iter()
            .any(|finding| finding.code == codes::REGION_POOL_OVERSUBSCRIBED
                && finding.unit_id.as_deref() == Some("900")),
        "the hex still says its tax pool cannot pay both taxers"
    );
    assert_eq!(
        row.at_month_end,
        Some(0),
        "the settled column: a $100 share spent on $100 of grain"
    );

    // The plan's own fixture C, pinned so the reason it was replaced cannot quietly stop being
    // true: adding `STUDY combat` leaves the unit taxing nothing at all, so it buys nothing, and
    // the `not-enough-silver` the plan expected to go quiet is the study fee's and fires either
    // way. Neither figure moves with this bead's subtraction - there is no contended share left to
    // settle.
    let (studying, studying_held, studying_findings) = both_surfaces(
        &text,
        "unit 900\nTAX\nBUY ALL grain\nSTUDY combat\nunit 901\nTAX\n",
        "900",
        "GRAI",
    );
    assert_eq!(studying.income, Some(0), "a studying unit taxes nothing");
    assert_eq!(studying.buy_all[0].bought, 0);
    assert_eq!(studying.buy_all[0].silver_available, 0);
    assert_eq!(studying_held, 0);
    assert!(
        studying_findings
            .iter()
            .any(|finding| finding.code == codes::NOT_ENOUGH_SILVER
                && finding.unit_id.as_deref() == Some("900")),
        "the study fee it cannot pay is still warned about"
    );
}
