//! A **numbered** `BUY` written by a unit taxing an oversubscribed region pool is sized by the
//! unit's settled share, on both surfaces (`ah-ud89.4`).
//!
//! `rules/buy` caps a line at what the unit can afford: *"If the unit can't afford as many as
//! [quantity], it will attempt to buy as many as it can."* `rules/economy_taxingpillaging` splits
//! an oversubscribed pool evenly - *"the tax income is split evenly among all taxers"* - and gives
//! each taxing man $50, so two ten-orc taxers each ask $500 and each settles at half the region's
//! base. Every unit below carries `Skills: combat [COMB] 1 (30).`, without which it does not tax at
//! all. The goods are `data/GRAI`; `rules/sequenceofevents` fixes which phases run before *"BUY
//! orders are processed"*.
//!
//! Round 2 of this family's interview had scoped a numbered `BUY` out on the premise that it is
//! never quantity-capped by silver. That was wrong, and the navigator reversed the decision in
//! round 4 (`docs/ui/ah-ud89-round4.html`, *Question 1*). These tests are that reversal.

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
    // The preview carries only what *changed*, so a unit whose orders move no item at all is
    // absent from it - which is the ITEMS surface saying it bought none, and is fixture B's
    // expected shape rather than a missing unit.
    let held: i64 = preview
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.unit.unit_id == unit_id)
        .flat_map(|unit| unit.unit.items.iter())
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum();

    (row, held)
}

/// Two of the player's ten-orc units, both combat-ready, both holding no silver.
const BUYER: &str = "* Buyers (900), Foo (1), 10 orcs [ORC]. Weight: 100. \
                     Capacity: 0/0/150/0. Skills: combat [COMB] 1 (30).";
const TAXER: &str = "* Taxers (901), Foo (1), 10 orcs [ORC]. Weight: 100. \
                     Capacity: 0/0/150/0. Skills: combat [COMB] 1 (30).";

/// Fixture A. A $200 pool, two taxers, grain at $10: the settled share is $100, which buys ten of
/// the twelve ordered. The ask is charged in full whatever the line buys, so the shortfall warning
/// still fires off `wanted_for_orders`.
#[test]
fn a_numbered_buy_is_sized_by_the_settled_share() {
    let text = report(
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $200.",
        "50 grain [GRAI] at $10.",
        &[BUYER, TAXER],
    );
    let (row, held) = both_surfaces(
        &text,
        "unit 900\nTAX\nBUY 12 grain\nunit 901\nTAX\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.income, Some(100), "half of a $200 pool, split evenly");
    assert_eq!(row.expense, Some(100), "ten grain at $10, not twelve");
    assert_eq!(row.at_month_end, Some(0));
    assert_eq!(
        row.wanted_for_orders,
        Some(120),
        "the whole ask is still charged, so the shortfall is still said"
    );
    assert_eq!(held, 10, "and the ITEMS surface says the same ten");

    // The control: the same report and the same buyer, with 901's `TAX` dropped from the script -
    // so nobody contends, the pool is 900's alone, and this bead moves nothing.
    let (row, held) = both_surfaces(&text, "unit 900\nTAX\nBUY 12 grain\n", "900", "GRAI");

    assert_eq!(
        row.income,
        Some(200),
        "an uncontended taxer collects it all"
    );
    assert_eq!(row.expense, Some(120));
    assert_eq!(row.at_month_end, Some(80));
    assert_eq!(held, 12, "and buys every one it ordered");
}

/// Fixture B. A $100 pool split two ways pays $50, and one grain costs $60: the line buys none.
/// A `60` anywhere here is the ledger's pooled reading still reaching the cap.
#[test]
fn a_numbered_buy_the_settled_share_cannot_pay_for_buys_none() {
    let text = report(
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $100.",
        "50 grain [GRAI] at $60.",
        &[BUYER, TAXER],
    );
    let (row, held) = both_surfaces(
        &text,
        "unit 900\nTAX\nBUY 1 grain\nunit 901\nTAX\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.income, Some(50));
    assert_eq!(row.expense, Some(0), "$50 does not buy a $60 grain");
    assert_eq!(row.wanted_for_orders, Some(60));
    assert_eq!(row.at_month_end, Some(50));
    assert_eq!(held, 0);
}

/// Fixture C. The case the navigator's round-4 answer was actually about: a numbered `BUY` and a
/// `BUY ALL` on adjacent lines of one unit, sized from one purse.
///
/// The arithmetic: the ledger charges the numbered line its whole ask of $120 against a hopeful
/// $200, leaving $80; `settle_buy_all` adds back the $20 it was over-charged and takes off the $100
/// overstatement, reaching $0 - so the `BUY ALL` buys none.
#[test]
fn the_two_buy_forms_are_sized_from_one_purse() {
    let text = report(
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $200.",
        "50 grain [GRAI] at $10.",
        &[BUYER, TAXER],
    );
    let (row, held) = both_surfaces(
        &text,
        "unit 900\nTAX\nBUY 12 grain\nBUY ALL grain\nunit 901\nTAX\n",
        "900",
        "GRAI",
    );

    assert_eq!(row.buy_all.len(), 1);
    assert_eq!(row.buy_all[0].bought, 0, "the share is already spent");
    assert_eq!(row.buy_all[0].capped_by, BuyAllCap::Silver);
    assert_eq!(held, 10, "the numbered line's ten, and nothing more");
    assert_eq!(row.at_month_end, Some(0));
}
