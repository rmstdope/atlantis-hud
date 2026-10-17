//! A sharing unit's doubt about something other than silver leaves its hex's shared silver counted
//! (`ah-0ift`).
//!
//! `mountain (36,4)` of the committed turn 42: Ivanhoe, son of Cedric (683) shares (`rules/share`),
//! and his faction-mates Brian de Bois-Guilbert (1159), Reginald Front-de-Boeuf (1161) and Rebecca
//! (1163) cast and study on what the pool lends them. A `GIVE` of mithril swords to a foreign unit
//! leaves whether the swords went unknowable, and a second `GIVE` of the same swords to a
//! faction-mate is then uncounted - but neither line moves silver, so the pool still covers them.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The report's own template, with `extra` added under Ivanhoe (683).
fn orders_with(extra: &[&str]) -> String {
    let report = atlantis_hud_fixtures::G3_F42_T42.text;
    let template = extract_orders_template(report).expect("a template").text;
    let mut orders = String::new();
    for line in template.lines() {
        orders.push_str(line);
        orders.push('\n');
        if line.trim() == "unit 683" {
            for order in extra {
                orders.push_str(order);
                orders.push('\n');
            }
        }
    }
    assert!(orders.contains("unit 683"), "683 is in the template");
    orders
}

fn forecasts(orders: &str) -> Vec<UnitSilver> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default()).silver
}

fn forecast<'a>(all: &'a [UnitSilver], unit_id: &str) -> &'a UnitSilver {
    all.iter()
        .find(|silver| silver.unit_id == unit_id)
        .unwrap_or_else(|| panic!("unit {unit_id} should have a forecast"))
}

const DEPENDANTS: [&str; 3] = ["1159", "1161", "1163"];

#[test]
fn the_pool_covers_the_dependants_with_one_gift_of_swords() {
    let all = forecasts(&orders_with(&["GIVE 4139 1 MSWO"]));
    for unit in DEPENDANTS {
        let end = forecast(&all, unit).at_month_end;
        assert!(
            end.is_some_and(|end| end >= 0),
            "{unit} is lent what it spends, and ends at {end:?}"
        );
    }
}

#[test]
fn a_second_gift_of_the_same_swords_leaves_the_pool_counted() {
    let one = forecasts(&orders_with(&["GIVE 4139 1 MSWO"]));
    let two = forecasts(&orders_with(&["GIVE 4139 1 MSWO", "GIVE 1160 2 MSWO"]));
    for unit in DEPENDANTS {
        let before = forecast(&one, unit);
        let after = forecast(&two, unit);
        assert_eq!(
            after.at_month_end, before.at_month_end,
            "{unit}: neither gift moves silver, so the pool lends as before"
        );
        assert_eq!(
            after.shared_silver_coverage, before.shared_silver_coverage,
            "{unit}: the pool is judged as before"
        );
    }
    let (before, after) = (forecast(&one, "683"), forecast(&two, "683"));
    assert_eq!(
        (after.at_month_end, after.doubt),
        (before.at_month_end, before.doubt),
        "the giver's own silver is no more doubtful for a second gift of swords"
    );
}

#[test]
fn giving_all_the_swords_leaves_the_pool_counted_too() {
    let one = forecasts(&orders_with(&["GIVE 4139 1 MSWO"]));
    for second in ["GIVE 1160 ALL MSWO", "GIVE 1160 2 MSWO"] {
        let two = forecasts(&orders_with(&["GIVE 4139 1 MSWO", second]));
        for unit in DEPENDANTS {
            assert_eq!(
                forecast(&two, unit).at_month_end,
                forecast(&one, unit).at_month_end,
                "{unit} under {second:?}"
            );
        }
    }
}
