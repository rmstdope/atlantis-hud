//! A unit whose line the report cut short is not priced, and the corpus is untouched.
//!
//! `ah-l09a.4`. A report wrapped at a narrower column than the game's own leaves a unit's line cut
//! short, and everything after the break never reaches the model. The money then sees a unit
//! holding no `SILV` - `held` is `0` because nothing was read, not because the unit is penniless -
//! and, worse, a headcount of zero to price maintenance against. `rules/economy_maintenance`
//! prices the fee per head, so a headcount that was never read prices no month at all.
//!
//! The unit tests in `orders/silver.rs` pin the refusal itself against hand-built facts. This file
//! pins the *wiring*: that `semantics::unit_facts` derives the fact from a real report's own
//! items, and - the regression that matters - that no unit of any committed fixture is refused.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{SilverDoubt, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The fixture whose two units this file cuts short, as its own text.
fn the_report() -> String {
    atlantis_hud_fixtures::G5_F21_T39.text.to_string()
}

/// One unit's forecast, out of a whole turn reviewed exactly as the application reviews it.
fn forecast_of(report: &str, unit_id: &str) -> UnitSilver {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(report);
    classify_units(&mut parsed, &ruleset);
    let orders = extract_orders_template(report)
        .map(|template| template.text)
        .unwrap_or_default();
    let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
    review
        .silver
        .into_iter()
        .find(|silver| silver.unit_id == unit_id)
        .unwrap_or_else(|| panic!("unit {unit_id} should have a forecast"))
}

/// Replaces the one physical line containing `needle` with `replacement`, and fails loudly if the
/// fixture no longer holds it - a silent no-op here would make every assertion below vacuous.
fn rewrite_line(report: &str, needle: &str, replacement: &str) -> String {
    let mut found = false;
    let out: Vec<String> = report
        .lines()
        .map(|line| {
            if line.contains(needle) {
                assert!(!found, "{needle} should appear on exactly one line");
                found = true;
                replacement.to_string()
            } else {
                line.to_string()
            }
        })
        .collect();
    assert!(found, "the fixture should still hold a line with {needle}");
    out.join("\n")
}

/// Unit 9498's line, one flag shorter, wraps its items off the end: the report never reaches its
/// `SILV`, so its silver was never read.
#[test]
fn the_forecast_refuses_a_unit_whose_line_lost_its_tail() {
    let cut = rewrite_line(
        &the_report(),
        "* Drones (9498), Borg (21), revealing faction, sharing, 100 gnolls",
        "* Drones (9498), Borg (21), revealing faction, 100 gnolls",
    );
    let silver = forecast_of(&cut, "9498");
    assert_eq!(silver.doubt, Some(SilverDoubt::SilverNeverRead));
    assert_eq!(silver.at_month_end, None);
    assert_eq!(silver.upkeep, None);
}

/// Unit 3364's line is cut short *after* its `563 silver [SILV]`, so what it holds is a fact and
/// its month is not.
#[test]
fn the_forecast_keeps_silver_it_did_read() {
    let cut = rewrite_line(
        &the_report(),
        "  orcs [ORC], 563 silver [SILV]. Weight: 50. Capacity: 0/0/75/0.",
        "  orcs [ORC], 563 silver [SILV],",
    );
    let silver = forecast_of(&cut, "3364");
    assert_eq!(silver.doubt, Some(SilverDoubt::UnitLineCutShort));
    assert_eq!(silver.held, 563);
    assert_eq!(silver.at_month_end, None);
}

/// The regression that matters. Every unit of every committed fixture is read whole, so none of
/// them may carry either new doubt - which is also what proves `money_read_of` reads the report's
/// own items rather than the projection's, since this month's gifts move silver about freely.
#[test]
fn every_committed_fixture_still_prices_every_unit() {
    let ruleset = ruleset();
    for report in atlantis_hud_fixtures::ALL {
        let mut parsed = parse_report_full(report.text);
        classify_units(&mut parsed, &ruleset);
        let orders = extract_orders_template(report.text)
            .map(|template| template.text)
            .unwrap_or_default();
        let review = review_turn(&parsed, &orders, Some(&ruleset), CheckOptions::default());
        for silver in &review.silver {
            assert!(
                silver.doubt != Some(SilverDoubt::SilverNeverRead)
                    && silver.doubt != Some(SilverDoubt::UnitLineCutShort),
                "{}: unit {} was read whole and must not be refused ({:?})",
                report.file,
                silver.unit_id,
                silver.doubt
            );
        }
    }
}
