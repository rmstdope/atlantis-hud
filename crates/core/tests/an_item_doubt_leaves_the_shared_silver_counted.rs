//! A sharing unit's doubt about something other than silver leaves its hex's shared silver counted
//! (`ah-0ift`).
//!
//! `mountain (36,4)` of the committed turn 42: Ivanhoe, son of Cedric (683) shares (`rules/share`).
//! Under the report's own template Rebecca (1163) studies on what the pool lends her; Brian de
//! Bois-Guilbert (1159) pays his own way until he hands most of his silver to Ivanhoe, after which
//! his CAST borrows from the pool too. A `GIVE` of mithril swords to a foreign unit leaves whether
//! the swords went unknowable, and a second `GIVE` of the same swords to a faction-mate is then
//! uncounted - but neither line moves silver, so the pool still covers them both.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{SharedSilverCoverage, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// Brian's silver handed to the sharer, so his CAST must borrow from the pool.
const BRIAN_LENDS: (&str, &[&str]) = ("1159", &["GIVE 683 1500 SILV"]);

/// The report's own template, with `extra`'s orders added under each named unit.
fn orders_with(extra: &[(&str, &[&str])]) -> String {
    let report = atlantis_hud_fixtures::G3_F42_T42.text;
    let template = extract_orders_template(report).expect("a template").text;
    let mut orders = String::new();
    for line in template.lines() {
        orders.push_str(line);
        orders.push('\n');
        if let Some(unit) = line.trim().strip_prefix("unit ") {
            for (_, added) in extra.iter().filter(|(who, _)| *who == unit) {
                for order in *added {
                    orders.push_str(order);
                    orders.push('\n');
                }
            }
        }
    }
    for (unit, _) in extra {
        assert!(
            orders.contains(&format!("unit {unit}\n")),
            "{unit} is in the template"
        );
    }
    orders
}

/// Ivanhoe's orders, with Brian lending his silver to him.
fn ivanhoe(orders: &'static [&'static str]) -> String {
    orders_with(&[("683", orders), BRIAN_LENDS])
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

/// The two faction-mates the pool lends to under [`ivanhoe`].
const BORROWERS: [&str; 2] = ["1159", "1163"];

#[test]
fn the_pool_covers_its_borrowers_with_one_gift_of_swords() {
    let all = forecasts(&ivanhoe(&["GIVE 4139 1 MSWO"]));
    for unit in BORROWERS {
        let silver = forecast(&all, unit);
        assert_eq!(
            (silver.at_month_end, silver.shared_silver_coverage),
            (Some(0), Some(SharedSilverCoverage::Covered)),
            "{unit} is lent what it spends"
        );
    }
}

#[test]
fn a_second_gift_of_the_same_swords_leaves_the_pool_counted() {
    const TWO_GIFTS: [&[&str]; 2] = [
        &["GIVE 4139 1 MSWO", "GIVE 1160 2 MSWO"],
        &["GIVE 4139 1 MSWO", "GIVE 1160 ALL MSWO"],
    ];
    for orders in TWO_GIFTS {
        let second = orders[1];
        let one = forecasts(&ivanhoe(&["GIVE 4139 1 MSWO"]));
        let two = forecasts(&ivanhoe(orders));
        for unit in BORROWERS {
            let (before, after) = (forecast(&one, unit), forecast(&two, unit));
            assert_eq!(
                (after.at_month_end, after.shared_silver_coverage),
                (before.at_month_end, before.shared_silver_coverage),
                "{unit} under {second:?}: neither gift moves silver, so the pool lends as before"
            );
        }
        let (before, after) = (forecast(&one, "683"), forecast(&two, "683"));
        assert_eq!(
            (after.at_month_end, after.doubt),
            (before.at_month_end, before.doubt),
            "under {second:?} the giver's own silver is no more doubtful"
        );
    }
}

/// The half of the rule the fix keeps: silver a STEAL left uncertain, given on, is a sum nobody
/// can follow, so the sharer's purse is not judged (`ah-0jxx`).
#[test]
fn a_later_gift_of_uncertain_silver_still_leaves_the_pool_unjudged() {
    let stolen = forecasts(&orders_with(&[("683", &["STEAL 4139 SILV"])]));
    assert_eq!(
        forecast(&stolen, "1163").shared_silver_coverage,
        Some(SharedSilverCoverage::Covered),
        "the theft alone leaves the pool counted, or the case below proves nothing"
    );
    let given = forecasts(&orders_with(&[(
        "683",
        &["STEAL 4139 SILV", "GIVE 1160 10 SILV"],
    )]));
    assert_eq!(
        forecast(&given, "1163").shared_silver_coverage,
        Some(SharedSilverCoverage::Unjudged)
    );
}
