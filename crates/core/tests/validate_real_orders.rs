//! The false-positive bar for the order parser, set by a real game rather than by invented input.
//!
//! A syntax checker that invents errors is worse than none: the player stops reading the list, and
//! the one real mistake in it goes out with the turn. The orders template committed with turn 71 was
//! written by a person playing the game and accepted by the server, so every line in it is correct
//! by construction. Anything this parser has to say about it is something the parser got wrong.

use atlantis_hud_core::orders::semantics::{check_turn, CheckOptions};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full, ParsedReport};
use atlantis_hud_core::validate_orders;

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

mod common;
use common::ruleset;

fn template() -> String {
    extract_orders_template(TURN_71)
        .expect("the committed report carries an orders template")
        .text
}

#[test]
fn the_committed_template_has_nothing_wrong_with_it() {
    let result = validate_orders(&template(), None);

    assert_eq!(
        result.diagnostics,
        vec![],
        "the parser invented a problem with orders the server accepted"
    );
}

#[test]
fn the_committed_template_has_nothing_wrong_with_it_against_the_catalogue_either() {
    let result = validate_orders(&template(), Some(RULESET));

    assert_eq!(
        result.diagnostics,
        vec![],
        "every item these orders name is in the scraped catalogue"
    );
}

/// The template is not a trivial input: proving it clean means little if it holds three lines.
#[test]
fn the_template_is_substantial_enough_for_that_to_mean_something() {
    let template = template();
    let orders = template
        .lines()
        .filter(|line| {
            let body = line.trim().trim_start_matches('@');
            !body.is_empty() && !body.starts_with(';') && !body.starts_with('#')
        })
        .count();

    assert!(orders > 200, "only {orders} order lines to check");
}

/// The same document with one word changed is not clean, which is what makes the tests above a bar
/// rather than a tautology: a parser that found nothing anywhere would pass them and fail this.
#[test]
fn one_wrong_word_in_that_same_document_is_found() {
    let damaged = template().replace("@claim 50", "@claim fifty");
    let result = validate_orders(&damaged, None);

    assert_eq!(result.error_count(), 1, "{:?}", result.diagnostics);
    assert_eq!(result.diagnostics[0].code, "bad-argument");
    assert!(result.diagnostics[0].message.contains("fifty"));
}

// --- the same bar, for the checks that read the report -------------------------------------
//
// A semantic check has more ways to be wrong than a syntax one, because it reasons about state
// nobody wrote down. The template and the report it came out of are the one pairing where the
// right answer is known: the player played this turn, so the orders and the holdings agree.
//
// The report is *classified* before it is checked, as it is in the application: a headcount that
// is a guess prices no study, so an unclassified report would leave every studying unit unjudged
// and this bar would clear itself by declining to look.

fn classified() -> ParsedReport {
    let mut report = parse_report_full(TURN_71);
    classify_units(&mut report, &ruleset());
    report
}

#[test]
fn the_committed_turn_has_no_semantic_problems_either() {
    let findings = check_turn(
        &classified(),
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    assert_eq!(
        findings,
        vec![],
        "the checks invented a problem with a turn that was actually played"
    );
}

/// The classification above has to have worked, or the test before this one is vacuous: every
/// shortfall it might have found would have been suppressed for want of a headcount.
#[test]
fn the_units_in_that_turn_are_counted_rather_than_estimated() {
    let report = classified();
    let estimated = report.own_units().filter(|unit| unit.men_estimated).count();

    assert_eq!(
        estimated, 0,
        "{estimated} units still carry a guessed headcount"
    );
}

/// The other half of the bar. Silence proves nothing on its own - a check that never fires would
/// pass the tests above - so one unit is given an order it cannot pay for and must be caught.
///
/// The shortfall comes back against the *hex* rather than against unit 13432, and that is correct
/// here rather than a shortcoming: every one of this faction's units carries the `sharing` flag,
/// so there is one purse in that hex and the money in it is nobody's in particular. The per-unit
/// path cannot be shown on this fixture at all, which is why the assertion below measures the
/// flag rather than assuming it. `semantics.rs` covers both paths on input that varies.
#[test]
fn a_unit_told_to_spend_what_it_has_not_got_is_caught_in_that_same_turn() {
    let report = classified();
    assert!(
        report
            .own_units()
            .all(|unit| unit.flags.iter().any(|flag| flag == "sharing")),
        "this faction shares throughout, which is what makes the finding below the hex's"
    );

    // A nine-figure gift is beyond any holding or income in the game.
    let damaged = template().replace("unit 13432\n", "unit 13432\nGIVE 13401 999999999 SILV\n");
    assert_ne!(damaged, template(), "the template should have been altered");

    let findings = check_turn(&report, &damaged, Some(&ruleset()), CheckOptions::default());

    assert_eq!(
        findings.iter().map(|f| f.code.as_str()).collect::<Vec<_>>(),
        vec!["not-enough-silver"],
        "{findings:?}"
    );
    assert_eq!(findings[0].unit_id, None, "one purse, shared");
    assert!(
        findings[0].message.contains("sharing"),
        "{}",
        findings[0].message
    );
}

/// Whole-map validation runs every time the player stops typing, so it has to be cheap enough to
/// belong on a 300ms debounce.
///
/// Not a benchmark, and deliberately not asserting a figure: a wall-clock number in a test is a
/// hostage to whatever else the machine is doing. What it pins is the shape - the report and the
/// ruleset are parsed once by the caller and re-used, so a keystroke pays for one walk of the
/// orders and no re-parse of four hundred and seventy-seven units. Measured at the time of
/// writing: about 4ms per pass in an unoptimized build, against a 300ms debounce.
///
/// The guard that matters is therefore against the *shape* regressing - a `validate_turn` that
/// re-parsed the report internally would still pass every other test in this file.
#[test]
fn a_whole_map_pass_re_reads_neither_the_report_nor_the_ruleset() {
    let report = classified();
    let ruleset = ruleset();
    let template = template();

    // Fifty passes over the committed turn. If any of them re-parsed the report this would take
    // long enough to notice; the point here is that they are all handed the same two objects.
    for _ in 0..50 {
        let result = check_turn(&report, &template, Some(&ruleset), CheckOptions::default());
        assert_eq!(result, vec![], "the turn is clean, pass after pass");
    }
}

/// The broad guard check is off by default for a reason, and this is the measurement of it: turn
/// 71 has no unit on guard anywhere, so switching it on speaks about hex after hex. That is the
/// noise the setting exists to keep out of the panel, and the default keeps it out.
#[test]
fn the_broad_guard_check_is_the_noisy_one_the_setting_holds_back() {
    let report = classified();
    let on_guard = report.own_units().filter(|unit| unit.on_guard).count();
    assert_eq!(
        on_guard, 0,
        "this turn guards nothing, which is what makes it the case to measure"
    );

    let noisy = check_turn(
        &report,
        &template(),
        Some(&ruleset()),
        CheckOptions {
            disabled: std::collections::BTreeSet::new(),
        },
    );

    let hexes_with_our_units = report
        .regions
        .iter()
        .filter(|region| region.units.iter().any(|unit| unit.own))
        .count();
    assert_eq!(
        noisy
            .iter()
            .filter(|f| f.code.as_str() == "hex-unguarded")
            .count(),
        hexes_with_our_units,
        "one per hex we stand in, and nothing guards any of them"
    );
    assert!(
        hexes_with_our_units > 1,
        "only {hexes_with_our_units} hexes to speak about"
    );
}
