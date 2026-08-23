//! The false-positive bar for the order parser, set by a real game rather than by invented input.
//!
//! A syntax checker that invents errors is worse than none: the player stops reading the list, and
//! the one real mistake in it goes out with the turn. The orders template committed with turn 71 was
//! written by a person playing the game and accepted by the server, so every line in it is correct
//! by construction. Anything this parser has to say about it is something the parser got wrong.

use atlantis_hud_core::orders::semantics::{check_turn, review_turn, CheckOptions, Finding};
use atlantis_hud_core::orders::silver::SilverDoubt;
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
///
/// `not-enough-silver` is **absent**, and its history is worth keeping because the table has moved
/// twice for two different real reasons:
///
/// - It was **two** until `ah-uwa3`. Unit 1688, alone in `1:15,63`, is a hill dwarf owing $10 that
///   holds nothing - but it orders `@work` in a hex paying `$26.0`, and wages arrive in the turn's
///   last phase, in time for maintenance if not for anything the orders spend. So its fee is
///   covered and it is no longer short. `ah-uwa3`'s plan predicted this table would not move,
///   reading the turn as having no order that could be affected; the turn's one `WORK` order is
///   exactly the affected case, and the finding that went is the bug the bead was filed to fix.
/// - It was **one** until `ah-fjty`. Unit 18642, alone in `1:7,53`, is a leader owing $50 that
///   holds neither silver nor food, in a hex holding no silver at all - so neither the hex's shared
///   purse nor the game's own regional pooling could cover it. But the header states
///   `Unclaimed silver: 6038`, and step 7 of the payment order claims that silver automatically for
///   units that would otherwise starve; the same unit's own `@claim 50` leaves $5,988 of it, which
///   is ample. This is precisely the false alarm `ah-fjty` was filed about - a young faction still
///   holding its starting silver being told its units starve - and its disappearance from a real
///   committed turn is the bead proving itself on the corpus.
const EXPECTED: &[(&str, usize)] = &[
    ("magic-study-outside-building", 6),
    ("not-enough-items", 1),
    ("study-at-maximum", 1),
    ("unit-does-nothing", 2),
];

/// What the committed turn's 27 own units spend between them, all of it on `STUDY`.
const EXPECTED_SPENDING: i64 = 800;

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

/// `ah-bumi`: the committed turn does contain a `CLAIM` - unit 18642 in `mountain (7,53)` orders
/// `@claim 50` against a header that states `Unclaimed silver: 6038`. So this bead's arm is
/// exercised by the real turn rather than only by constructed fixtures, and the figure is pinned by
/// id: 50 is well inside the purse, so the cap does not bite and the claim is counted whole.
///
/// The turn's finding counts are unchanged, because this bead adds no check.
#[test]
fn the_committed_turns_claims_are_counted() {
    let report = classified();
    let review = review_turn(
        &report,
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    let claimant = review
        .silver
        .iter()
        .find(|unit| unit.unit_id == "18642")
        .expect("unit 18642 is an own unit of the committed turn");
    assert_eq!(claimant.income, Some(50));
    assert_eq!(claimant.doubt, None);

    assert_eq!(counts(&review.findings), expected_counts());
}

/// `ah-uwa3`: the Silver column and the `not-enough-silver` check must agree about wages.
///
/// The two drifted to opposite wrong answers for a whole epic because each had a test pinning its
/// own side and nothing asserted they agreed. This is that assertion. A unit whose orders spend
/// more than the silver reaching it *in time* can cover must be warned about - by its own finding,
/// or by a hex-level one for the purse its region shares.
///
/// **Unless the hex's purse covers it.** The column is per unit and the check pools across the hex
/// (`ah-1wcw.1`, and `ah-uwa3` deliberately does not move that line), so a unit that spends its
/// neighbours' silver is red in the column and silent in the check - and both are right. Unit 13401
/// in the committed turn is exactly that: it studies on money its hex-mates hold. So the
/// implication is asserted only where the whole hex is short, which is the case the two systems
/// really do have to agree about.
#[test]
fn the_column_and_the_check_agree_about_wages() {
    let review = review_turn(
        &classified(),
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    // What each hex has between its units, counting only silver that arrives in time to be spent.
    let mut hex_spare: BTreeMap<&str, i64> = BTreeMap::new();
    for entry in &review.silver {
        let (Some(income), Some(expense), Some(late)) =
            (entry.income, entry.expense, entry.late_income)
        else {
            continue;
        };
        *hex_spare.entry(entry.region_id.as_str()).or_insert(0) +=
            entry.held + income - late - expense;
    }

    for entry in &review.silver {
        let Some(short) = entry.short_for_orders else {
            continue;
        };
        if short <= 0 {
            continue;
        }
        // The shared purse covers it, so the check is right to stay silent (see above).
        if hex_spare
            .get(entry.region_id.as_str())
            .is_some_and(|spare| *spare >= 0)
        {
            continue;
        }
        let warned = review.findings.iter().any(|finding| {
            finding.code.as_str() == "not-enough-silver"
                && (finding.unit_id.as_deref() == Some(entry.unit_id.as_str())
                    || (finding.unit_id.is_none() && finding.region_id == entry.region_id))
        });
        assert!(
            warned,
            "unit {} is ${short} short for its orders and nothing warns about it: {:?}",
            entry.unit_id, review.findings
        );
    }
}

/// `ah-1wcw.2`: the committed turn contains no `SELL`, no `ENTERTAIN`, no earning `CAST` and no
/// `GIVE` of silver to a unit - its 136 gifts all move items, 130 of them to nobody at all. So the
/// income sources this bead adds must leave every figure in it exactly where `ah-1wcw.1` left them.
///
/// A green run here is evidence that nothing broke, not that anything works: the rules themselves
/// are proved on the constructed fixtures in `orders::silver` and `orders::semantics`.
#[test]
fn the_committed_turn_has_no_sales_gifts_entertainment_or_earning_magic() {
    let report = classified();
    let review = review_turn(
        &report,
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    for unit in &review.silver {
        assert_eq!(
            unit.received, 0,
            "{} is credited a gift the turn does not contain",
            unit.unit_id
        );
        assert!(
            unit.givers.is_empty(),
            "{} names givers the turn does not contain",
            unit.unit_id
        );
        assert!(
            !matches!(unit.doubt, Some(SilverDoubt::UnknownGoods)),
            "{} is doubted for a source the turn does not contain: {:?}",
            unit.unit_id,
            unit.doubt
        );
    }

    // The turn's own findings are untouched: this bead adds no check, and in particular does not
    // move `not-traded-here`, which fires zero times here and would be the first sign that market
    // resolution had changed rather than silver arithmetic.
    assert_eq!(counts(&review.findings), expected_counts());
}

/// `ah-1wcw.3`: the committed turn contains no `BUY`, no `WITHDRAW` and no `GIVE` of silver - its
/// 136 gifts all move items, and all six of its casts consume swords and plate armour rather than
/// silver. So the expense sources this bead adds must leave every figure in it exactly where
/// `ah-1wcw.1` left them: studying, and nothing else.
///
/// A green run here is evidence that nothing broke, not that anything works. The rules are proved
/// on the constructed fixtures in `orders::silver`.
#[test]
fn the_committed_turn_has_no_purchases_withdrawals_or_gifts_of_silver() {
    let report = classified();
    let review = review_turn(
        &report,
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    for unit in &review.silver {
        assert_eq!(
            unit.given_to_nobody, 0,
            "{} discards silver the turn does not discard",
            unit.unit_id
        );
        assert!(
            !matches!(
                unit.doubt,
                Some(SilverDoubt::MarketDoesNotSell)
                    | Some(SilverDoubt::UnpricedWithdrawal)
                    | Some(SilverDoubt::GivesAWholeClass)
            ),
            "{} is doubted for an expense the turn does not contain: {:?}",
            unit.unit_id,
            unit.doubt
        );
    }

    // Studying is the whole of this turn's spending, and it landed in `ah-1wcw.1`. Pinned as one
    // total rather than per unit: a new expense source anywhere would move it, and a table of 27
    // rows would have to be renegotiated by every later child of this epic.
    let spent: i64 = review
        .silver
        .iter()
        .map(|unit| unit.expense.unwrap_or(0))
        .sum();
    assert_eq!(
        spent, EXPECTED_SPENDING,
        "the committed turn's total expense"
    );

    assert_eq!(counts(&review.findings), expected_counts());
}

/// `ah-1wcw.4`: every unit's monthly maintenance, summed over the committed turn.
///
/// The number is the one the rules produce over *this* report - 10 silver a character, 50 a
/// leader, less any food a consuming unit spends on it - rather than a figure quoted anywhere: the
/// bead's plan predicted 1,900 from a headcount of 38 leaders, and the classified turn is not made
/// of that.
#[test]
fn the_committed_turns_upkeep_is_what_its_headcount_owes() {
    let report = classified();
    let review = review_turn(
        &report,
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    // The fee, before step 7 of the payment order settles any of it. `ah-fjty` made the column's
    // `upkeep` what the unit is *left* paying, so the fee is that plus what the faction's unclaimed
    // fund covered - and it is the fee, not the remainder, that this turn's headcount fixes.
    let owed: i64 = review
        .silver
        .iter()
        .filter_map(|unit| unit.upkeep.map(|left| left + unit.unclaimed_covered))
        .sum();
    assert_eq!(owed, 2_140);

    // What the player is actually shown, once the header's $6,038 unclaimed - less unit 18642's own
    // `@claim 50` - has fed every unit that could not pay (`ah-fjty`).
    let shown: i64 = review.silver.iter().filter_map(|unit| unit.upkeep).sum();
    assert_eq!(shown, 2_090);
    let covered: i64 = review
        .silver
        .iter()
        .map(|unit| unit.unclaimed_covered)
        .sum();
    // $50, and only $50: this faction shares throughout, so almost every unit's maintenance is
    // already paid by its hex's pooled silver and never reaches the fund at all. The one claimant
    // is unit 18642, alone in `1:7,53` - a leader owing $50 in a hex holding nothing else. Reading
    // each unit's own balance instead would have claimed $870 here, for units their faction-mates'
    // silver pays for, which is the same contradiction `ah-7cdt` removed for faction food.
    assert_eq!(
        covered, 50,
        "the fund reaches every claimant, so it says which"
    );
    let fed: Vec<&str> = review
        .silver
        .iter()
        .filter(|unit| unit.unclaimed_covered > 0)
        .map(|unit| unit.unit_id.as_str())
        .collect();
    assert_eq!(fed, ["18642"]);
    assert!(
        review.silver.iter().all(|unit| !unit.unclaimed_contended),
        "the fund covers them all, so nothing is contended"
    );
    assert!(
        review.silver.iter().all(|unit| unit.upkeep.is_some()),
        "every own unit in this turn is counted rather than estimated, so every one can be priced"
    );
}

/// `ah-7cdt`: the committed turn carries eleven units set to `consuming faction's food`, and no
/// food anywhere near them, so this bead leaves every figure in it exactly where `ah-1wcw.4` did.
///
/// The plan expected the turn to carry the flag at all; it does, in hex `1:26,52`, where 22 own
/// units stand and not one holds grain, livestock, fish or meals. An empty pool feeds nobody and
/// doubts nobody (settled with the navigator on 2026-08-23), so the turn's total maintenance is
/// unmoved at 2,140 and the whole of this bead is invisible here. That is the finding: the real
/// turn exercises step 2's *no food* branch and nothing else.
///
/// `ah-fjty` then made the column show what step 7's unclaimed fund pays of a starving unit's fee,
/// so the assertion below adds `unclaimed_covered` back on to recover the fee this test is about.
/// None of these eleven is actually fed by the fund - they share, so their hex's pooled silver
/// pays them - but the assertion is written to survive that either way. Step 2 is still doing
/// nothing here, which is the point.
#[test]
fn the_committed_turn_has_faction_food_eaters_but_no_faction_food() {
    let report = classified();
    let review = review_turn(
        &report,
        &template(),
        Some(&ruleset()),
        CheckOptions::default(),
    );

    let drawing: Vec<&str> = report
        .regions
        .iter()
        .flat_map(|region| &region.units)
        .filter(|unit| {
            unit.own
                && unit
                    .flags
                    .iter()
                    .any(|flag| flag.eq_ignore_ascii_case("consuming faction's food"))
        })
        .map(|unit| unit.unit_id.as_str())
        .collect();
    assert_eq!(drawing.len(), 11, "{drawing:?}");

    // Every one of them is in a hex whose own units hold no food at all, so each pays what its own
    // headcount owes and none of them is doubted.
    for id in &drawing {
        let unit = review
            .silver
            .iter()
            .find(|forecast| &forecast.unit_id == id)
            .expect("every own unit is forecast");
        // `unit_upkeep_of` models steps 1 and 2 only, so it can only be *equalled* where steps 5
        // and 6 have no food to work with (`ah-eacd`). A unit holding food may pay less than the
        // helper says, never more, and an inequality is the strongest thing the helper can then
        // honestly assert.
        let recovered = unit.upkeep.map(|left| left + unit.unclaimed_covered);
        if holds_food(&report, id) {
            assert!(
                recovered.unwrap_or(0) <= unit_upkeep_of(&report, id),
                "{id}: food can only ever reduce the fee"
            );
        } else {
            assert_eq!(recovered, Some(unit_upkeep_of(&report, id)), "{id}");
        }
    }
    assert!(
        review
            .silver
            .iter()
            .all(|unit| unit.doubt != Some(SilverDoubt::ContestedFactionFood)),
        "an empty pool doubts nobody"
    );
}

/// What one unit's headcount owes, straight from the rules, for the test above to compare against.
/// Whether this unit holds any of the food the maintenance rules name - the only units steps 5 and
/// 6 of the payment order can touch (`ah-eacd`).
fn holds_food(report: &ParsedReport, unit_id: &str) -> bool {
    report
        .regions
        .iter()
        .flat_map(|region| &region.units)
        .filter(|unit| unit.unit_id == unit_id)
        .any(|unit| {
            unit.items.iter().any(|item| {
                item.amount > 0
                    && ["GRAI", "LIVE", "FISH", "MEAL"]
                        .iter()
                        .any(|tag| item.tag.eq_ignore_ascii_case(tag))
            })
        })
}

fn unit_upkeep_of(report: &ParsedReport, id: &str) -> i64 {
    let unit = report
        .regions
        .iter()
        .flat_map(|region| &region.units)
        .find(|unit| unit.unit_id == id)
        .expect("the unit is in the report");
    let leaders: i64 = unit
        .men_by_race
        .iter()
        .filter(|entry| entry.tag.eq_ignore_ascii_case("LEAD"))
        .map(|entry| entry.amount)
        .sum();
    leaders * 50 + (unit.men - leaders) * 10
}
