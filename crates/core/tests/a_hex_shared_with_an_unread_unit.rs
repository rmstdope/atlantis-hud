//! A share taken beside a hex-mate whose line was cut short is a ceiling, and the corpus is untouched.
//!
//! `ah-0n2k.1`. A hex holding an own unit whose report line was cut short settles its tax base, its
//! wage pool and its entertainment demand as if that unit asked for nothing: the men, flags and
//! skills that say what it asks went with the tail, so it drops out of every `wanting` and its
//! faction-mates are handed shares that counted no claim for it. Those shares keep their figures
//! and are relabelled as the most they can be.
//!
//! The unit tests in `orders/semantics.rs` pin the rule against hand-built facts. This file pins
//! the *wiring*: that a real report's own wrapping produces the cut-short hex-mate, and - the
//! regression that matters - that no unit of any committed fixture is bounded.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::{SilverDoubt, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// The fixture whose one unit this file cuts short, as its own text.
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

/// `unwrap_lines` decides a physical line is a *continuation* when its first word could not have
/// fitted on the previous line at `WRAP_COLUMN = 70`. So shortening a unit's first physical line
/// detaches its continuation: unit 8537's line is 63 characters and its continuation begins with
/// `receiving` (9), so `63 + 1 + 9 = 73 > 70` and it is attached today. Deleting the eight
/// characters `behind, ` leaves 55, and `55 + 1 + 9 = 65`, so it detaches - and unit 8537 reaches
/// the model with no items at all.
///
/// Hex `plain (38,40)` in `Blarnfashire` holds exactly two own units: `* Drone (1288)`, which
/// carries the `taxing` flag, and `* Drone (8537)`.
#[test]
fn a_taxers_share_is_a_ceiling_when_a_hex_mate_was_not_read() {
    let cut = rewrite_line(
        &the_report(),
        "* Drone (8537), Borg (21), avoiding, behind, revealing faction,",
        "* Drone (8537), Borg (21), avoiding, revealing faction,",
    );

    // Without this the edit did not cut the line and every assertion below is vacuous.
    assert_eq!(
        forecast_of(&cut, "8537").doubt,
        Some(SilverDoubt::SilverNeverRead),
        "the shortened line should have detached its continuation"
    );

    let taxer = forecast_of(&cut, "1288");
    assert!(taxer.income_in_time_at_most);
    assert!(
        !taxer.late_income_at_most,
        "1288 taxes and does not work, so the late half is exact"
    );
    assert_eq!(
        taxer.doubt, None,
        "the figure is kept, only its label changes"
    );
    assert_eq!(
        taxer.income,
        forecast_of(&the_report(), "1288").income,
        "the figure itself is untouched, which is the whole of the agreed answer"
    );
}

/// The hex that is fine must cost nothing: no committed fixture holds a cut-short line, so nothing
/// anywhere in the corpus may read as a ceiling. This is the test that would catch a predicate
/// firing on every hex.
#[test]
fn every_committed_fixture_bounds_nothing() {
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
                !silver.income_in_time_at_most && !silver.late_income_at_most,
                "{}: unit {} sits in a hex read in full and must not be bounded",
                report.file,
                silver.unit_id
            );
        }
    }
}
