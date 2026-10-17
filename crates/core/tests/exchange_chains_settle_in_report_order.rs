//! `ah-6cni`. Exchange pairs that pay for or drain one another settle as the engine walks the
//! units in report order, not in the order the lines are written.
//!
//! `rules/exchange`: *"If either unit involved does not have the items it is offering, or if the
//! exchange orders given are not complementary, the exchange is aborted."* When it checks is the
//! engine's (`runorders.cpp` `DoExchangeOrders`/`DoExchangeOrder`): it visits every unit in report
//! order and each of its EXCHANGE lines in turn. At a pair's first visit it checks that the
//! *partner* holds what it offers (`GetSharedNum`). At the second visit it checks the first
//! visitor's holding and, if both checks passed, moves both sides (`ConsumeShared`). So a pair
//! completed earlier in the walk can pay for, or drain, a pair completed later.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::SilverChangeCause;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// Ivanhoe (683) with horses, Maurice de Bracy (1160) with silver and Cedric (900) with wood, in
/// that report order, all ours; Stash (2393) lends 4 horses to its faction-mates by `SHARE`. The
/// market wants wood and horses, so a SELL of either is read against what the exchanges left.
fn report_text(ivanhoe_horses: u32) -> String {
    [
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.".to_string(),
        "  Wanted: 10 wood [WOOD] at $20, 10 horses [HORS] at $40.".to_string(),
        "  For Sale: none.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
        if ivanhoe_horses == 0 {
            "* Ivanhoe (683), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.".to_string()
        } else {
            format!(
                "* Ivanhoe (683), Foo (1), leader [LEAD], {ivanhoe_horses} horses [HORS]. Weight: \
                 210. Capacity: 0/0/85/0."
            )
        },
        "* Maurice de Bracy (1160), Foo (1), leader [LEAD], 400 silver [SILV]. Weight: 10. \
         Capacity: 0/0/15/0."
            .to_string(),
        "* Cedric (900), Foo (1), leader [LEAD], 5 wood [WOOD]. Weight: 260. Capacity: 0/0/15/0."
            .to_string(),
        "* Stash (2393), Foo (1), sharing, leader [LEAD], 4 horses [HORS]. Weight: 210. \
         Capacity: 0/0/85/0."
            .to_string(),
        String::new(),
    ]
    .join("\n")
}

/// Orders for Ivanhoe, Maurice and Cedric.
type Orders<'a> = (&'a str, &'a str, &'a str);

fn script_for(text: &str, (ivanhoe, maurice, cedric): Orders) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 683\n{ivanhoe}\nunit 1160\n{maurice}\nunit 900\n{cedric}\n")
}

fn review_of(horses: u32, orders: Orders) -> TurnReview {
    let ruleset = ruleset();
    let text = report_text(horses);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &script_for(&text, orders),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

/// What the SILVER column says the exchanges moved for `unit_id`, summed.
fn silver_exchanged(horses: u32, orders: Orders, unit_id: &str) -> i64 {
    review_of(horses, orders)
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .expect("the column has a row for the unit")
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Exchanged)
        .map(|change| change.amount)
        .sum()
}

/// What `seller` (683, 1160 or 900) is paid when it adds `sell` to its orders. A SELL is sized
/// from what the transfer walk's reading of the exchanges leaves it (`early_holding`), capped by
/// the ledger's, so this reads both settlements.
fn sold_for(horses: u32, orders: Orders, seller: &str, sell: &str) -> i64 {
    let with = |unit: &str, own: &str| {
        if unit == seller {
            format!("{own}\n{sell}")
        } else {
            own.to_string()
        }
    };
    let (ivanhoe, maurice, cedric) = (
        with("683", orders.0),
        with("1160", orders.1),
        with("900", orders.2),
    );
    review_of(horses, (&ivanhoe, &maurice, &cedric))
        .silver
        .iter()
        .find(|row| row.unit_id == seller)
        .expect("the column has a row for the seller")
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::Sold)
        .map(|change| change.amount)
        .sum()
}

/// What the ITEMS preview leaves `unit_id` holding of `tag`: the ledger's reading.
fn holding(horses: u32, orders: Orders, unit_id: &str, tag: &str, unchanged: i64) -> i64 {
    let text = report_text(horses);
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &script_for(&text, orders),
    )
    .expect("the committed ruleset loads");
    let Some(unit) = common::preview_row(&text, &preview, unit_id) else {
        return unchanged;
    };
    unit.unit
        .items
        .iter()
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum()
}

/// Probe 1 of the bead. Ivanhoe trades a horse to Cedric for wood and that wood on to Maurice for
/// silver. Maurice comes before Cedric in the report, so the game reaches Maurice's pair before
/// Ivanhoe holds any wood, and aborts it; Cedric's pair then goes ahead and Ivanhoe keeps its wood.
#[test]
fn a_pair_completed_before_the_one_that_pays_for_it_is_aborted() {
    let orders = (
        "EXCHANGE 900 1 HORS 1 WOOD\nEXCHANGE 1160 1 WOOD 1 SILV",
        "EXCHANGE 683 1 SILV 1 WOOD",
        "EXCHANGE 683 1 WOOD 1 HORS",
    );
    assert_eq!(
        silver_exchanged(4, orders, "1160"),
        0,
        "Maurice's silver stays"
    );
    assert_eq!(
        holding(4, orders, "1160", "WOOD", 0),
        0,
        "Maurice gets no wood"
    );
    assert_eq!(
        holding(4, orders, "900", "HORS", 0),
        1,
        "Cedric gets his horse"
    );
    assert_eq!(
        holding(4, orders, "683", "WOOD", 0),
        1,
        "Ivanhoe keeps the wood"
    );
    assert_eq!(
        sold_for(4, orders, "683", "SELL 1 WOOD"),
        20,
        "Ivanhoe still holds the wood it sells"
    );
}

/// Probe 2 of the bead. Ivanhoe pays Cedric silver it only gets from Maurice, by a line written
/// after it. Maurice comes before Cedric in the report, so Maurice's pair completes first and pays
/// Ivanhoe in time: Cedric is paid, and Ivanhoe gets Cedric's wood.
#[test]
fn a_pair_completed_after_the_one_that_pays_for_it_goes_ahead() {
    let orders = (
        "EXCHANGE 900 200 SILV 1 WOOD\nEXCHANGE 1160 2 HORS 200 SILV",
        "EXCHANGE 683 200 SILV 2 HORS",
        "EXCHANGE 683 1 WOOD 200 SILV",
    );
    assert_eq!(silver_exchanged(4, orders, "900"), 200, "Cedric is paid");
    assert_eq!(
        holding(4, orders, "683", "WOOD", 0),
        1,
        "Ivanhoe gets the wood"
    );
    assert_eq!(
        sold_for(4, orders, "683", "SELL 1 WOOD"),
        20,
        "Ivanhoe still holds the wood it sells"
    );
}

/// Probe 3 of the bead. Ivanhoe holds no horses and offers Stash's 4 to two partners. Maurice's
/// pair completes first in report order and takes them, so Cedric's pair, written first, is the
/// one that aborts.
#[test]
fn a_sharers_stock_goes_to_the_pair_completed_first_in_report_order() {
    let orders = (
        "EXCHANGE 900 4 HORS 1 WOOD\nEXCHANGE 1160 4 HORS 1 SILV",
        "EXCHANGE 683 1 SILV 4 HORS",
        "EXCHANGE 683 1 WOOD 4 HORS",
    );
    assert_eq!(
        holding(0, orders, "1160", "HORS", 0),
        4,
        "Maurice gets the horses"
    );
    assert_eq!(holding(0, orders, "900", "HORS", 0), 0, "Cedric gets none");
    assert_eq!(
        holding(0, orders, "2393", "HORS", 4),
        0,
        "Stash lent all four"
    );
    assert_eq!(
        sold_for(0, orders, "1160", "SELL 4 HORS"),
        160,
        "Maurice holds the horses he sells"
    );
}
