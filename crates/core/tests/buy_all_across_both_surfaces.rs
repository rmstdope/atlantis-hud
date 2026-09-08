//! Every property of a `BUY ALL` that `silver.rs`'s own `mod tests` used to pin, held across
//! **both** walks that answer for one (`ah-6m7b.2`).
//!
//! These ten tests were unit tests over a `UnitFacts` with `phases: None` - a `forecast_unit`
//! call with no ledger behind it. Since `ah-6m7b.2` a `BUY ALL` is priced in exactly one place,
//! `semantics::settle_buy_all`, and the SILVER column reports what that decided through
//! `UnitFacts::settled_buy_all`; a ledger-less caller therefore prices none at all and there was
//! nothing left for those tests to exercise.
//!
//! Re-expressed here as `review_turn` cases over hand-built reports, each asserting the same
//! property it always did **and** that the ITEMS surface agrees - so nothing is lost and each now
//! guards both walks instead of one. Every figure below was measured on this tree.
//!
//! `data/GRAI` is the goods throughout, `data/COMB` prices a month of combat study at 10 silver
//! per man, and `rules/sequenceofevents` fixes which phases run before *"Market orders"*.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{BuyAllCap, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex, one market line, and whatever own units the caller names.
///
/// The men must be the *first* item on each own unit's line: `count_men` reads the headcount off
/// `items.first()`.
fn report(region: &str, for_sale: &str, units: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        region.to_string(),
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

/// The unit's SILVER row and how many of `tag` the ITEMS preview leaves it holding.
fn both_surfaces(text: &str, script: &str, unit_id: &str, tag: &str) -> (UnitSilver, i64) {
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
    let held: i64 = preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == unit_id)
        .expect("the preview has the unit")
        .unit
        .items
        .iter()
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum();

    (row, held)
}

/// A quiet region: nothing to tax, nothing to pillage, no wages worth having.
const QUIET: &str = "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.";

fn buyer(silver: i64) -> String {
    format!(
        "* Buyers (900), Foo (1), orc [ORC], {silver} silver [SILV]. Weight: 10. \
         Capacity: 0/0/15/0."
    )
}

/// The hover's own sentence: what was bought, and which cap stopped it.
#[test]
fn a_buy_all_says_what_it_bought_and_what_stopped_it() {
    let text = report(QUIET, "30 grain [GRAI] at $18.", &[&buyer(356)]);
    let (row, held) = both_surfaces(&text, "unit 900\nBUY ALL grain\n", "900", "GRAI");

    assert_eq!(row.buy_all.len(), 1);
    assert_eq!(row.buy_all[0].bought, 19, "356 silver buys nineteen at 18");
    assert_eq!(row.buy_all[0].capped_by, BuyAllCap::Silver);
    assert_eq!(held, 19, "and the ITEMS ledger says the same");
}

/// Silver is the cap, and the whole of it is spent.
#[test]
fn buying_all_spends_what_the_unit_can_afford() {
    let text = report(QUIET, "40 grain [GRAI] at $12.", &[&buyer(500)]);
    let (row, held) = both_surfaces(&text, "unit 900\nBUY ALL grain\n", "900", "GRAI");

    assert_eq!(row.buy_all[0].bought, 40, "500 silver would buy forty-one");
    assert_eq!(held, 40);
}

/// The market is the other cap, and a rich unit stops at the line.
#[test]
fn buying_all_takes_no_more_than_the_market_has() {
    let text = report(QUIET, "4 grain [GRAI] at $12.", &[&buyer(500)]);
    let (row, held) = both_surfaces(&text, "unit 900\nBUY ALL grain\n", "900", "GRAI");

    assert_eq!(row.buy_all[0].bought, 4, "the market holds four");
    assert_eq!(row.buy_all[0].capped_by, BuyAllCap::Market);
    assert_eq!(held, 4);
}

/// `rules/sequenceofevents` opens the market after *"Spells are CAST"*, so a cast's cost *does*
/// come off what a `BUY ALL` can afford - the half of the phase order that must not move
/// (`ah-a5ci`). `data/CRPA` prices Create Amulet of Protection at 200 silver.
#[test]
fn a_cast_still_shrinks_what_a_buy_all_can_afford() {
    let mage = "* Mages (900), Foo (1), behind, orc [ORC], 400 silver [SILV]. Weight: 10. \
                Capacity: 0/0/15/0. Skills: create amulet of protection [CRPA] 1 (30).";
    let text = report(QUIET, "20 grain [GRAI] at $20.", &[mage]);
    let (row, held) = both_surfaces(
        &text,
        "unit 900\nCAST Create_Amulet_Of_Protection\nBUY ALL grain\n",
        "900",
        "GRAI",
    );

    assert_eq!(
        row.buy_all[0].bought, 10,
        "the amulet takes 200 of the 400, and 200 buys ten at 20"
    );
    assert_eq!(held, 10);
}

/// And the other half of that phase order: the market opens **before** *"STUDY orders are
/// processed"*, so a study's fee does not shrink what a `BUY ALL` can afford (`ah-a5ci`). The
/// study is then short, which is what the `not-enough-silver` warning exists to say - and until
/// `ah-6m7b.2` the ITEMS ledger disagreed with this very expectation.
#[test]
fn a_study_does_not_shrink_what_a_buy_all_can_afford() {
    let text = report(QUIET, "20 grain [GRAI] at $20.", &[&buyer(100)]);
    let (row, held) = both_surfaces(
        &text,
        "unit 900\nSTUDY combat\nBUY ALL grain\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.buy_all[0].bought, 5, "100 silver buys five at 20");
    assert_eq!(held, 5, "and the ITEMS ledger says the same");
    assert!(
        row.at_month_end.is_some_and(|left| left < 0),
        "the study is then unpaid: {:?}",
        row.at_month_end
    );
}

/// `rules/sequenceofevents` runs *Give orders* before *Market orders*, so a `GIVE ... ALL SILV`
/// empties the purse before a `BUY ALL` prices anything - whichever line each is written on
/// (`ah-npab`).
#[test]
fn buying_all_after_giving_all_silver_away_buys_nothing_in_either_text_order() {
    let text = report(
        QUIET,
        "10 grain [GRAI] at $20.",
        &[
            &buyer(100),
            "* Hands (901), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        ],
    );
    for script in [
        "unit 900\nGIVE 901 ALL SILV\nBUY ALL grain\n",
        "unit 900\nBUY ALL grain\nGIVE 901 ALL SILV\n",
    ] {
        let (row, held) = both_surfaces(&text, script, "900", "GRAI");
        assert_eq!(row.buy_all.len(), 1, "{script}");
        assert_eq!(row.buy_all[0].bought, 0, "{script}: the purse is empty");
        assert_eq!(held, 0, "{script}: and the ITEMS ledger says the same");
    }
}

/// TAX settles before the market, so what this month earns pays for what this month buys
/// (`ah-1wcw.3`, `ah-uwa3`). `rules/economy_taxingpillaging` gives each taxing man $50, and
/// `data/COMB` is what lets a unit tax at all.
#[test]
fn buying_all_is_afforded_out_of_what_this_month_earns() {
    let taxer = "* Buyers (900), Foo (1), orc [ORC], 10 silver [SILV]. Weight: 10. \
                 Capacity: 0/0/15/0. Skills: combat [COMB] 1 (30).";
    let text = report(
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $1000.",
        "40 grain [GRAI] at $12.",
        &[taxer],
    );
    let (row, held) = both_surfaces(&text, "unit 900\nBUY ALL grain\nTAX\n", "900", "GRAI");

    assert_eq!(row.income, Some(50), "one taxing man earns fifty");
    assert_eq!(
        row.buy_all[0].bought, 5,
        "the 50 taxed on top of the 10 held buys five at 12, where the 10 alone would buy none"
    );
    assert_eq!(held, 5);
}

/// PILLAGE resolves before the market too, and this is the test that fails if the credit is ever
/// routed through `late_income` (`ah-1wcw.3`, `ah-uwa3`).
#[test]
fn a_pillaging_unit_can_afford_what_it_pillaged_for() {
    let pillager = "* Buyers (900), Foo (1), 100 orcs [ORC], 100 swords [SWOR]. Weight: 1000. \
                    Capacity: 0/0/1500/0. Skills: combat [COMB] 1 (30).";
    let text = report(
        "plain (1,1) in Nowhere, 10000 peasants (orcs), $2500.",
        "40 grain [GRAI] at $12.",
        &[pillager],
    );
    let (row, held) = both_surfaces(&text, "unit 900\nPILLAGE\nBUY ALL grain\n", "900", "GRAI");

    assert_eq!(row.income, Some(5000), "twice the region's tax base");
    assert_eq!(
        row.buy_all[0].bought, 40,
        "and the pillaged silver buys the whole line"
    );
    assert_eq!(held, 40);
}

/// `ah-lauy`, increment 2: a second `BUY ALL` of the same goods finds the line already spent by
/// the first and buys nothing more.
#[test]
fn a_second_buy_all_of_the_same_goods_buys_nothing() {
    let text = report(QUIET, "5 grain [GRAI] at $12.", &[&buyer(100)]);
    let (row, held) = both_surfaces(
        &text,
        "unit 900\nBUY ALL grain\nBUY ALL grain\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.buy_all.len(), 2, "each line gets its own sentence");
    assert_eq!(row.buy_all[0].bought, 5, "the first takes the whole line");
    assert_eq!(row.buy_all[1].bought, 0, "the second finds nothing left");
    assert_eq!(held, 5, "and the ITEMS ledger says the same");
}

/// `ah-lauy`, increment 2, the settled-share path: with a second buyer contending for the line
/// this unit gets a share smaller than the market holds, and its own second `BUY ALL` cannot take
/// that share twice.
#[test]
fn a_second_buy_all_cannot_take_its_share_twice() {
    let text = report(
        QUIET,
        "20 grain [GRAI] at $12.",
        &[
            &buyer(10_000),
            "* Rivals (901), Foo (1), orc [ORC], 10000 silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0.",
        ],
    );
    let (row, held) = both_surfaces(
        &text,
        "unit 900\nBUY ALL grain\nBUY ALL grain\nunit 901\nBUY ALL grain\n",
        "900",
        "GRAI",
    );

    let share = row.buy_all[0].bought;
    assert!(
        share > 0 && share < 20,
        "the line is contended, so this unit gets a share of it: {share}"
    );
    assert_eq!(
        row.buy_all[1].bought, 0,
        "and its second line cannot take that share a second time"
    );
    assert_eq!(held, share, "and the ITEMS ledger says the same");
}
