//! `ah-efb5`. The buying side of `region-pool-oversubscribed` counts what the game will actually
//! try to buy, so its number agrees with the split the SILVER column shows.
//!
//! `rules/buy`: *"If the unit can't afford as many as [quantity], it will attempt to buy as many as
//! it can. If the demand for items exceeds the supply, the available items will be split among the
//! buyers in proportion to the amount each buyer attempted to buy."* `rules/playing_units`:
//! *"Leaders and normal people may not be mixed in the same unit"* - the engine refuses such a
//! `BUY` outright (`Game::GetBuyAmount`, ../Atlantis `runorders.cpp`), so it attempts nothing.
//!
//! The counted total is each buyer's order cut to what it can pay for, less anything refused for
//! mixing; when it differs from what was written, a clause says by how much and why.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One own unit of the fixture: its number, the men it holds, and its silver.
struct Unit {
    id: u32,
    men: &'static str,
    silver: i64,
    skills: &'static str,
}

/// A market selling `for_sale`, with the given units of faction Foo standing in it. The region
/// pays `$0`, so no wage moves and each unit's silver is what it can spend at the market.
fn report(for_sale: &str, units: &[Unit]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.".to_string(),
        String::new(),
        format!("  For Sale: {for_sale}."),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
    ];
    for unit in units {
        lines.push(format!(
            "* Unit {id} ({id}), Foo (1), {men}, {silver} silver [SILV]. Weight: 10. \
             Capacity: 0/0/15/0. Skills: {skills}.",
            id = unit.id,
            men = unit.men,
            silver = unit.silver,
            skills = unit.skills,
        ));
        lines.push(String::new());
    }
    lines.join("\n")
}

fn review_of(text: &str, script: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    review_turn(
        &parsed,
        &format!("{template}\n{script}"),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

/// Every `region-pool-oversubscribed` message, as `(unit, message)`, in the order raised.
fn oversubscribed(review: &TurnReview) -> Vec<(String, String)> {
    review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == "region-pool-oversubscribed")
        .map(|finding| {
            (
                finding.unit_id.clone().unwrap_or_default(),
                finding.message.clone(),
            )
        })
        .collect()
}

fn orcs(id: u32, silver: i64) -> Unit {
    Unit {
        id,
        men: "3 orcs [ORC]",
        silver,
        skills: "combat [COMB] 1 (30)",
    }
}

fn leader(id: u32) -> Unit {
    Unit {
        id,
        men: "1 leaders [LEAD]",
        silver: 1000,
        skills: "combat [COMB] 1 (30)",
    }
}

/// A lone leader who has studied a Foundation (`data/items`, `force [FORC]`): a mage.
fn mage(id: u32) -> Unit {
    Unit {
        skills: "force [FORC] 1 (30)",
        ..leader(id)
    }
}

const SIX_ORCS: &str = "5 leaders [LEAD] at $100, 6 orcs [ORC] at $38";
const TWO_ORCS: &str = "2 orcs [ORC] at $38";

fn every_claimant_reads(review: &TurnReview, units: &[&str], message: &str) {
    let found = oversubscribed(review);
    let expected: Vec<(String, String)> = units
        .iter()
        .map(|unit| ((*unit).to_string(), message.to_string()))
        .collect();
    assert_eq!(found, expected, "{:?}", review.findings);
}

/// Nothing cut or refused: today's sentence, with no clause.
#[test]
fn nothing_cut_or_refused_reads_as_today() {
    let text = report(SIX_ORCS, &[orcs(11, 1000), orcs(12, 1000)]);
    let review = review_of(&text, "unit 11\nBUY 4 orcs\nunit 12\nBUY 4 orcs\n");

    every_claimant_reads(
        &review,
        &["11", "12"],
        "your units here buy 8 orcs between them and this market has 6",
    );
}

/// Unit 12's $114 pays for three of its six orcs, so the line is attempted by 6 + 3 = 9.
#[test]
fn a_buyer_cut_to_its_silver_is_counted_after_the_cut() {
    let text = report(SIX_ORCS, &[orcs(11, 1000), orcs(12, 114)]);
    let review = review_of(&text, "unit 11\nBUY 6 orcs\nunit 12\nBUY 6 orcs\n");

    every_claimant_reads(
        &review,
        &["11", "12"],
        "your units here buy 9 orcs between them and this market has 6 \
         (12 ordered, cut to what they can pay for)",
    );
}

/// Unit 12's $76 pays for two of its four orcs: 4 + 2 = 6 are attempted where 6 are for sale, so
/// the line is not oversubscribed.
#[test]
fn cut_down_to_the_market_raises_no_warning() {
    let text = report(SIX_ORCS, &[orcs(11, 1000), orcs(12, 76)]);
    let review = review_of(&text, "unit 11\nBUY 4 orcs\nunit 12\nBUY 4 orcs\n");

    every_claimant_reads(&review, &[], "");
}

/// A lone buyer whose $114 pays for three of its five orcs, where two are for sale.
#[test]
fn a_lone_buyer_cut_to_its_silver_says_it() {
    let text = report(TWO_ORCS, &[orcs(11, 114)]);
    let review = review_of(&text, "unit 11\nBUY 5 orcs\n");

    every_claimant_reads(
        &review,
        &["11"],
        "this unit buys 3 orcs and this market has 2 (5 ordered, cut to what it can pay for)",
    );
}

/// Unit 10's leader cannot recruit orcs, so its five are refused and attempt nothing.
#[test]
fn refused_recruits_are_left_out_and_named() {
    let text = report(SIX_ORCS, &[leader(10), orcs(11, 1000), orcs(12, 1000)]);
    let review = review_of(
        &text,
        "unit 10\nBUY 5 orcs\nunit 11\nBUY 4 orcs\nunit 12\nBUY 5 orcs\n",
    );

    every_claimant_reads(
        &review,
        &["11", "12"],
        "your units here buy 9 orcs between them and this market has 6 \
         (14 ordered, 5 of them refused for mixing with leaders)",
    );
}

/// The one buyer left beside a refused faction-mate reads the lone sentence, with the refusal.
#[test]
fn a_lone_buyer_beside_a_refused_one_names_the_refusal() {
    let text = report(TWO_ORCS, &[leader(10), orcs(11, 1000)]);
    let review = review_of(&text, "unit 10\nBUY 2 orcs\nunit 11\nBUY 3 orcs\n");

    every_claimant_reads(
        &review,
        &["11"],
        "this unit buys 3 orcs and this market has 2 \
         (5 ordered, 2 of them refused for mixing with leaders)",
    );
}

/// Five refused, and unit 12's $114 paying for three of its six: 6 + 3 = 9 of 17 written.
#[test]
fn refused_and_cut_name_both_refused_first() {
    let text = report(SIX_ORCS, &[leader(10), orcs(11, 1000), orcs(12, 114)]);
    let review = review_of(
        &text,
        "unit 10\nBUY 5 orcs\nunit 11\nBUY 6 orcs\nunit 12\nBUY 6 orcs\n",
    );

    every_claimant_reads(
        &review,
        &["11", "12"],
        "your units here buy 9 orcs between them and this market has 6 \
         (17 ordered: 5 refused for mixing with leaders, 3 cut to what they can pay for)",
    );
}

/// A leader line is refused too when the buyer holds normal men (`rules/playing_units`), but the
/// agreed words name only men refused for mixing *with leaders*, so such a refusal is left out of
/// both figures - as before - rather than described falsely (review finding 1).
#[test]
fn leaders_refused_for_mixing_with_men_are_not_named() {
    let text = report(SIX_ORCS, &[orcs(10, 1000), leader(11), leader(12)]);
    let review = review_of(
        &text,
        "unit 10\nBUY 3 leaders\nunit 11\nBUY 3 leaders\nunit 12\nBUY 3 leaders\n",
    );

    every_claimant_reads(
        &review,
        &["11", "12"],
        "your units here buy 6 leaders between them and this market has 5",
    );
}

/// A refused unit's `BUY ALL` lines are written once, as an unrefused unit's are (`ah-lauy`):
/// two of them refuse the line's six, not twelve (review finding 2).
#[test]
fn a_refused_buy_all_is_written_once_per_unit() {
    let text = report(SIX_ORCS, &[leader(10), orcs(11, 1000), orcs(12, 1000)]);
    let review = review_of(
        &text,
        "unit 10\nBUY ALL orcs\nBUY ALL orcs\nunit 11\nBUY 4 orcs\nunit 12\nBUY 4 orcs\n",
    );

    every_claimant_reads(
        &review,
        &["11", "12"],
        "your units here buy 8 orcs between them and this market has 6 \
         (14 ordered, 6 of them refused for mixing with leaders)",
    );
}

/// A mage's recruiting is refused because it is a mage (`rules/magic`, the navigator's `ah-ndp9`
/// ruling), and the agreed words would misname that: it stays out of both figures, as before
/// (review finding 3).
#[test]
fn a_mages_refused_recruits_are_not_named() {
    let text = report(SIX_ORCS, &[mage(10), orcs(11, 1000), orcs(12, 1000)]);
    let review = review_of(
        &text,
        "unit 10\nBUY 5 orcs\nunit 11\nBUY 4 orcs\nunit 12\nBUY 4 orcs\n",
    );

    every_claimant_reads(
        &review,
        &["11", "12"],
        "your units here buy 8 orcs between them and this market has 6",
    );
}
