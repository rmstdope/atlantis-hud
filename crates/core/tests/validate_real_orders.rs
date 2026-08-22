//! The false-positive bar for the order parser, set by a real game rather than by invented input.
//!
//! A syntax checker that invents errors is worse than none: the player stops reading the list, and
//! the one real mistake in it goes out with the turn. The orders template committed with turn 71 was
//! written by a person playing the game and accepted by the server, so every line in it is correct
//! by construction. Anything this parser has to say about it is something the parser got wrong.

use atlantis_hud_core::orders::semantics::{check_turn, review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full, ParsedReport};
use atlantis_hud_core::validate_orders;
use std::collections::BTreeMap;

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

mod common;
use common::ruleset;

/// What the committed turn genuinely contains, per code.
///
/// A table rather than a positional list of codes or an absolute total, because those made every
/// new advisory check renegotiate this file: a list moves when a check is added anywhere, and a
/// count of ten says nothing about *which* ten (ah-11lh). A new check adds a row here and touches
/// nothing else - and, more importantly, a check that stops firing on real orders shows up as a
/// row that changed rather than disappearing into a total.
///
/// The turn is not clean and is not meant to be; each row is a real finding about real orders:
///
/// - `unit-does-nothing` (ah-dwk6): units 14451 and 13432 are given no orders at all. Both are
///   parked cargo units; the navigator was shown that measurement and chose to warn about them
///   anyway rather than exempt an empty block.
/// - `magic-study-outside-building` (ah-a2k.2): the Borg mages aboard the Cloudship
///   `Princess of the Dawn [1239]` study force (881, 12878, 12879, 20, 12880) and pattern (12881)
///   while a Cloudship is not a kind the ruleset's buildings table seats mages in. The navigator
///   settled this against the alternative on 2026-08-17: a structure the table does not name is no
///   shelter, so these are real halved months and not invented problems - even though this turn's
///   own "Errors during turn" section does not carry the engine's advisory for them.
/// - `study-at-maximum` (ah-1uj): unit 13402 is reported at combat [COMB] 5 (450) - the ruleset's
///   own maximum - and orders "@study comb" anyway, which is a real wasted month.
/// - `not-enough-items` (ah-dbb.2): the enchant-armor mages are short plate armor between them.
const EXPECTED: &[(&str, usize)] = &[
    ("magic-study-outside-building", 6),
    ("not-enough-items", 1),
    ("study-at-maximum", 1),
    ("unit-does-nothing", 2),
];

/// The expectation table as a map, so an assertion can be read as a table.
fn expected_counts() -> BTreeMap<&'static str, usize> {
    let table: BTreeMap<&'static str, usize> = EXPECTED.iter().copied().collect();
    // A duplicated code would collapse into one row here and quietly take the second row's count,
    // so the table would still look like a table while asserting something nobody wrote.
    assert_eq!(
        table.len(),
        EXPECTED.len(),
        "a code appears twice in EXPECTED: {EXPECTED:?}"
    );
    table
}

/// The findings by code, so an expectation can be compared as a table rather than as a total.
fn counts(findings: &[Finding]) -> BTreeMap<&'static str, usize> {
    let mut seen = BTreeMap::new();
    for finding in findings {
        *seen.entry(finding.code.as_str()).or_insert(0) += 1;
    }
    seen
}

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

/// Since ah-dbb.2, this turn has exactly one real finding: four mages in hex `1:26,52`
/// `CAST earm` (enchant armor) while the hex's shared stock holds no plate armor. The server
/// accepted the order - `RunEnchant` never refuses a cast, it just enchants nothing - so this is
/// not a mistake the *server* rejected. It is still a spell that spends the whole month to
/// produce nothing, which is exactly what a shortfall warning exists to catch; the navigator
/// chose to keep the warning (2026-08-16) rather than special-case enchant/transmutation as
/// silent, so this is the one finding the bar allows through rather than a gap in it.
#[test]
fn the_committed_turn_has_no_semantic_problems_either() {
    let findings = check_turn(
        &classified(),
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    // What the turn contains, per code - the exception log that used to live here is on
    // `EXPECTED`, which every assertion in this file now derives from. Only the fields that make
    // each finding specific are asserted below, not the whole struct, so an unrelated fixture edit
    // elsewhere in the turn does not force rewriting this test.
    assert_eq!(counts(&findings), expected_counts(), "{findings:?}");
    let idle: Vec<&str> = findings
        .iter()
        .filter(|f| f.code.as_str() == "unit-does-nothing")
        .filter_map(|f| f.unit_id.as_deref())
        .collect();
    assert_eq!(idle, ["14451", "13432"]);
    let halved: Vec<&str> = findings
        .iter()
        .filter(|f| f.code.as_str() == "magic-study-outside-building")
        .filter_map(|f| f.unit_id.as_deref())
        .collect();
    assert_eq!(halved, ["881", "12878", "12879", "20", "12880", "12881"]);
    let items = findings
        .iter()
        .find(|f| f.code.as_str() == "not-enough-items")
        .unwrap_or_else(|| panic!("no not-enough-items finding: {findings:?}"));
    assert_eq!(items.region_id, "1:26,52");
    assert_eq!(
        items.unit_id, None,
        "the hex shares, so the shortfall is the hex's"
    );
    assert_eq!(
        items.message,
        "the units in this hex are short 4 plate armor between them: they can have 0 and \
         their orders spend 4"
    );
    let study = findings
        .iter()
        .find(|f| f.code == atlantis_hud_core::orders::semantics::codes::STUDY_AT_MAXIMUM)
        .unwrap_or_else(|| panic!("no study-at-maximum finding: {findings:?}"));
    assert_eq!(study.unit_id.as_deref(), Some("13402"));
    assert_eq!(
        study.message,
        "this unit is already at combat 5, the highest the ruleset has"
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
///
/// The turn's own `not-enough-items` finding (see `the_committed_turn_has_no_semantic_problems_
/// either`) rides along here too - it belongs to a different hex, and `check_turn` appends by
/// region in report order, silver's hex first.
#[test]
fn a_unit_told_to_spend_what_it_has_not_got_is_caught_in_that_same_turn() {
    let report = classified();
    assert!(
        report
            .own_units()
            .all(|unit| unit.flags.iter().any(|flag| flag == "sharing")),
        "this faction shares throughout, which is what makes the finding below the hex's"
    );

    // A nine-figure gift is beyond any holding or income in the game. Unit 13401 is a real unit
    // elsewhere in this same report (see `semantics.rs`'s `give-target-not-here` fixtures), which
    // would also be a true positive for that check; it is disabled below because this test is about
    // the resource ledger, not the transfer-target check, and `semantics.rs` already covers the
    // latter on input built to vary it.
    let damaged = template().replace("unit 13432\n", "unit 13432\nGIVE 13401 999999999 SILV\n");
    assert_ne!(damaged, template(), "the template should have been altered");

    let mut options = CheckOptions::default();
    options.disabled.insert(
        atlantis_hud_core::orders::semantics::codes::GIVE_TARGET_NOT_HERE
            .as_str()
            .to_string(),
    );
    let findings = check_turn(&report, &damaged, Some(&ruleset()), options);

    // Alongside the introduced shortfall, the turn's genuine findings (see `EXPECTED`) still
    // fire - this fixture is not otherwise clean. Derived from the one table rather than repeated,
    // so a new check adds a row there and nothing here (ah-11lh).
    let mut expected = expected_counts();
    *expected.entry("not-enough-silver").or_insert(0) += 1; // the shortfall this case introduces
    assert_eq!(counts(&findings), expected, "{findings:?}");
    // The introduced shortfall, found by code rather than by position: two `unit-does-nothing`
    // findings now sort ahead of it (ah-dwk6).
    let shortfall = findings
        .iter()
        .find(|f| f.code.as_str() == "not-enough-silver")
        .unwrap_or_else(|| panic!("no not-enough-silver finding: {findings:?}"));
    assert_eq!(shortfall.unit_id, None, "one purse, shared");
    assert!(
        shortfall.message.contains("the units in this hex"),
        "{}",
        shortfall.message
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
    // The turn carries genuine findings throughout (see `EXPECTED`) - what this loop pins is that
    // every pass reports them identically, not that the turn is silent. The total is summed from
    // that same table so the three assertions in this file cannot drift apart (ah-11lh).
    let expected = check_turn(&report, &template, Some(&ruleset), CheckOptions::default());
    assert_eq!(
        expected.len(),
        EXPECTED.iter().map(|(_, n)| n).sum::<usize>(),
        "{expected:?}"
    );
    for _ in 0..50 {
        let result = check_turn(&report, &template, Some(&ruleset), CheckOptions::default());
        assert_eq!(
            result, expected,
            "every pass should report the same findings"
        );
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

/// `ah-1wcw.1`: every own unit in the committed turn gets a forecast, and no foreign one does -
/// and the finding counts are **unchanged**, which is this bead's claim that it adds no warning.
#[test]
fn the_committed_turn_forecasts_every_own_unit_and_none_of_the_others() {
    let report = classified();
    let review = review_turn(
        &report,
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    let own: Vec<&str> = report
        .regions
        .iter()
        .flat_map(|region| &region.units)
        .filter(|unit| unit.own)
        .map(|unit| unit.unit_id.as_str())
        .collect();
    assert_eq!(own.len(), 27, "the committed turn's own units: {own:?}");

    let forecast: Vec<&str> = review
        .silver
        .iter()
        .map(|entry| entry.unit_id.as_str())
        .collect();
    assert_eq!(forecast, own);
    assert_eq!(counts(&review.findings), expected_counts());
}
