//! `ah-p5ow`. An `EXCHANGE` between two of our units that the game will abort is warned on the
//! lines involved.
//!
//! `rules/exchange`: *"The orders given by the two units must be complementary. If either unit
//! involved does not have the items it is offering, or if the exchange orders given are not
//! complementary, the exchange is aborted."* The engine says so in the next report
//! (`runorders.cpp` `DoExchangeOrder`: "EXCHANGE: Not giving enough. Expecting ..." and
//! "EXCHANGE: Exchange aborted. Not enough recieved."); until now the player was told nothing
//! before sending the orders.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

const CODE: &str = "exchange-aborted";

/// Ivanhoe (683) with horses and Maurice de Bracy (1160) with silver, both ours, and a foreign
/// unit Mark (7001) both can see - the shape of the bead's Aportheo case.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "  Wanted: none.",
        "  For Sale: none.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Ivanhoe (683), Foo (1), leader [LEAD], 4 horses [HORS]. Weight: 210. Capacity: \
         0/0/85/0.",
        "* Maurice de Bracy (1160), Foo (1), leader [LEAD], 400 silver [SILV]. Weight: 10. \
         Capacity: 0/0/15/0.",
        "* Cedric (900), Foo (1), leader [LEAD], 5 wood [WOOD]. Weight: 260. Capacity: 0/0/15/0.",
        "- Mark (7001), Bar (2), 5 orcs [ORC], 900 silver [SILV], 4 swords [SWOR].",
        "",
    ]
    .join("\n")
}

fn findings_of(ivanhoe: &str, maurice: &str) -> Vec<Finding> {
    findings_with_cedric(ivanhoe, maurice, "")
}

fn findings_with_cedric(ivanhoe: &str, maurice: &str, cedric: &str) -> Vec<Finding> {
    let ruleset = ruleset();
    let text = report_text();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let script =
        format!("{template}\nunit 683\n{ivanhoe}\nunit 1160\n{maurice}\nunit 900\n{cedric}\n");
    review_turn(&parsed, &script, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code.as_str() == CODE)
        .collect()
}

/// The units the warning is raised on, in order.
fn warned_units(findings: &[Finding]) -> Vec<&str> {
    findings
        .iter()
        .filter_map(|finding| finding.unit_id.as_deref())
        .collect()
}

const IVANHOE_OFFERS: &str = "EXCHANGE 1160 2 HORS 200 SILV";

/// Case (a): the partner wrote no EXCHANGE at all.
#[test]
fn an_exchange_with_no_answer_is_warned() {
    let findings = findings_of(IVANHOE_OFFERS, "");
    assert_eq!(warned_units(&findings), vec!["683"], "{findings:?}");
    let message = &findings[0].message;
    assert!(
        message.contains("Maurice de Bracy (1160)"),
        "names the partner: {message}"
    );
}

/// Case (b): the partner answers, but offers 150 silver where 200 is expected. Both lines are
/// aborted, so both are warned.
#[test]
fn an_exchange_whose_answer_does_not_match_is_warned_on_both_lines() {
    let findings = findings_of(IVANHOE_OFFERS, "EXCHANGE 683 150 SILV 2 HORS");
    assert_eq!(warned_units(&findings), vec!["683", "1160"], "{findings:?}");
    assert!(findings.iter().all(|finding| finding.line.is_some()));
    assert_eq!(
        findings[0].message,
        "EXCHANGE will be aborted: Maurice de Bracy (1160) offers 150 SILV for 2 HORS, not 200 \
         SILV for 2 HORS"
    );
    assert_eq!(
        findings[1].message,
        "EXCHANGE will be aborted: Ivanhoe (683) offers 2 HORS for 200 SILV, not 2 HORS for 150 \
         SILV"
    );
}

/// The control: a complementary pair goes ahead and is not warned.
#[test]
fn a_matched_exchange_is_not_warned() {
    let findings = findings_of(IVANHOE_OFFERS, "EXCHANGE 683 200 SILV 2 HORS");
    assert!(findings.is_empty(), "{findings:?}");
}

/// A foreign partner's orders are out of sight, so whether it answers cannot be said: no warning
/// (the line is listed uncounted instead, `ah-mw1r.2`).
#[test]
fn an_exchange_with_a_foreign_unit_is_not_warned() {
    let findings = findings_of("EXCHANGE 7001 2 HORS 200 SILV", "");
    assert!(findings.is_empty(), "{findings:?}");
}

/// The other abort `rules/exchange` names: complementary lines, but a side will not hold what it
/// offers. Both lines are warned, naming the side that is short.
#[test]
fn an_exchange_a_side_cannot_cover_is_warned_on_both_lines() {
    let findings = findings_of(
        "EXCHANGE 1160 2 HORS 500 SILV",
        "EXCHANGE 683 500 SILV 2 HORS",
    );
    assert_eq!(warned_units(&findings), vec!["683", "1160"], "{findings:?}");
    assert!(
        findings.iter().all(
            |finding| finding.message.contains("Maurice de Bracy (1160)")
                && finding.message.contains("400")
        ),
        "{findings:?}"
    );
}

/// Silver given to Ivanhoe earlier in the Give phase pays for its offer: `rules/sequenceofevents`
/// runs EXCHANGE after GIVE, so nothing is short and nothing is warned.
#[test]
fn an_offer_covered_by_an_earlier_gift_is_not_warned() {
    let findings = findings_of(
        "EXCHANGE 1160 50 SILV 2 HORS",
        "GIVE 683 50 SILV\nEXCHANGE 683 2 HORS 50 SILV",
    );
    // Maurice holds no horses: that pair is aborted, but for Maurice's shortfall, not Ivanhoe's.
    assert!(
        findings
            .iter()
            .all(|finding| !finding.message.contains("Ivanhoe (683) will hold")),
        "{findings:?}"
    );
}

/// Ivanhoe offers Cedric silver it only gets from Maurice, by another exchange written after it.
/// The game settles a pair as it reaches the second unit of it in report order, so Maurice's pair
/// (listed before Cedric) pays Ivanhoe in time and both go ahead: no "will be aborted" is said
/// (reviewer's finding 1 on PR #1699).
#[test]
fn an_offer_paid_for_by_another_exchange_is_not_warned_short() {
    let findings = findings_with_cedric(
        "EXCHANGE 900 200 SILV 1 WOOD\nEXCHANGE 1160 2 HORS 200 SILV",
        "EXCHANGE 683 200 SILV 2 HORS",
        "EXCHANGE 683 1 WOOD 200 SILV",
    );
    assert!(findings.is_empty(), "{findings:?}");
}

/// Maurice did answer, but with men, which `rules/exchange` refuses ("Men may not be
/// exchanged."): the warning says so rather than that he wrote nothing (reviewer's finding 3).
#[test]
fn an_answer_the_game_refuses_is_named_as_such() {
    let findings = findings_of(IVANHOE_OFFERS, "EXCHANGE 683 200 SILV 1 LEAD");
    assert_eq!(warned_units(&findings), vec!["683"], "{findings:?}");
    assert_eq!(
        findings[0].message,
        "EXCHANGE will be aborted: Maurice de Bracy (1160) answers with men or goods the game will \
         not hand over"
    );
}

/// Another pair paying Cedric silver says nothing about Ivanhoe's swords: Ivanhoe is the short
/// side and nothing gives it swords, so the abort is certain and is warned (delta review's
/// finding 1 on PR #1699).
#[test]
fn a_pair_paying_the_side_that_is_not_short_does_not_hide_the_abort() {
    let findings = findings_with_cedric(
        "EXCHANGE 900 10 SWOR 50 SILV",
        "EXCHANGE 900 50 SILV 1 WOOD",
        "EXCHANGE 683 50 SILV 10 SWOR\nEXCHANGE 1160 1 WOOD 50 SILV",
    );
    assert_eq!(warned_units(&findings), vec!["683", "900"], "{findings:?}");
}

/// The engine settles exchanges as it walks the units in report order (`runorders.cpp`
/// `DoExchangeOrders`), not in the order the lines are written: Maurice's pair runs before
/// Cedric's here, so Ivanhoe's horses go to Maurice and it is Cedric's pair that aborts. Which one
/// is not told as certain (third review's finding 1a on PR #1699).
#[test]
fn a_chain_written_against_report_order_is_not_warned_on_the_wrong_lines() {
    let findings = findings_with_cedric(
        "EXCHANGE 900 4 HORS 1 WOOD\nEXCHANGE 1160 4 HORS 1 SILV",
        "EXCHANGE 683 1 SILV 4 HORS",
        "EXCHANGE 683 1 WOOD 4 HORS",
    );
    assert!(findings.is_empty(), "{findings:?}");
}
