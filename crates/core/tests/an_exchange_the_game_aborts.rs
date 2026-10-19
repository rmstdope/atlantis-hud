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
    // Maurice holds no horses, so the pair is aborted - for Maurice's shortfall alone.
    let messages: Vec<&str> = findings
        .iter()
        .map(|finding| finding.message.as_str())
        .collect();
    assert_eq!(
        messages,
        vec![
            "EXCHANGE will be aborted: Maurice de Bracy (1160) will hold only 0 of the 2 HORS it \
             offers";
            2
        ]
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

/// `rules/exchange`: "Men may not be exchanged." Maurice's line offering one is aborted and warned
/// on its own line; Ivanhoe's is then answered by nothing the game takes (fresh review's findings 3
/// and 5 on PR #1699).
#[test]
fn an_exchange_of_men_is_warned_and_answers_nothing() {
    let findings = findings_of(IVANHOE_OFFERS, "EXCHANGE 683 200 SILV 1 LEAD");
    let messages: Vec<(&str, &str)> = findings
        .iter()
        .map(|finding| {
            (
                finding.unit_id.as_deref().unwrap_or(""),
                finding.message.as_str(),
            )
        })
        .collect();
    assert_eq!(
        messages,
        vec![
            (
                "683",
                "EXCHANGE will be aborted: Maurice de Bracy (1160) has no EXCHANGE answering it"
            ),
            ("1160", "EXCHANGE will be aborted: men may not be exchanged"),
        ]
    );
}

/// Maurice's other line to Ivanhoe trades different goods: the mismatch named is the line with
/// the same two items (fresh review's finding 4).
#[test]
fn the_mismatch_named_is_the_line_with_the_same_goods() {
    let findings = findings_of(
        IVANHOE_OFFERS,
        "EXCHANGE 683 1 SILV 1 WOOD\nEXCHANGE 683 150 SILV 2 HORS",
    );
    assert!(
        findings
            .iter()
            .any(|finding| finding.unit_id.as_deref() == Some("683")
                && finding.message.contains("offers 150 SILV for 2 HORS")),
        "{findings:?}"
    );
}

/// Maurice also trades wood to a foreign unit for silver, which may pay his 500 in time: the
/// shortfall is not certain and is not told (fresh review's finding 1).
#[test]
fn a_shortfall_an_exchange_with_another_faction_may_cover_is_not_warned() {
    let findings = findings_of(
        "EXCHANGE 1160 2 HORS 500 SILV",
        "EXCHANGE 7001 5 WOOD 200 SILV\nEXCHANGE 683 500 SILV 2 HORS",
    );
    assert!(findings.is_empty(), "{findings:?}");
}

/// Maurice's answer names goods nothing can read: whether it matches cannot be said, so Ivanhoe
/// is not told it has no answer.
#[test]
fn an_answer_whose_goods_cannot_be_named_is_not_called_missing() {
    let findings = findings_of(IVANHOE_OFFERS, "EXCHANGE 683 200 WIDGETS 2 HORS");
    assert!(findings.is_empty(), "{findings:?}");
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

/// Maurice names Ivanhoe's new unit the long way, `FACTION 1 NEW 1` - our own faction, so the game
/// resolves it to that unit and the exchange may go ahead. Which unit such a line names is not
/// followed here, so the new unit is not told it has no answer (delta review on PR #1699).
#[test]
fn an_answer_naming_a_new_unit_by_faction_is_not_called_missing() {
    let findings = findings_of(
        "FORM 1\nEXCHANGE 1160 2 HORS 200 SILV\nEND",
        "EXCHANGE FACTION 1 NEW 1 200 SILV 2 HORS",
    );
    assert!(findings.is_empty(), "{findings:?}");
}

/// An item the game will not let change hands aborts the line offering or expecting it, named on
/// that line (the engine's `DoExchangeOrder`: "EXCHANGE: Can't trade ...").
#[test]
fn an_exchange_of_an_item_the_game_will_not_trade_is_warned() {
    let findings = findings_of(IVANHOE_OFFERS, "EXCHANGE 683 200 SILV 1 LION");
    assert!(
        findings
            .iter()
            .any(|finding| finding.unit_id.as_deref() == Some("1160")
                && finding.message == "EXCHANGE will be aborted: the game will not trade LION"),
        "{findings:?}"
    );
}

/// `ah-a58i`. Ivanhoe trades Maurice wood it only gets from Cedric. Maurice comes before Cedric
/// in the report, so the game reaches Maurice's pair before Cedric's has handed Ivanhoe the wood,
/// and aborts it (`rules/exchange`: "If either unit involved does not have the items it is
/// offering ... the exchange is aborted"; the walk is `runorders.cpp` `DoExchangeOrders`, ah-6cni).
/// Both lines of the aborted pair say so and name the late exchange; Cedric's pair goes ahead.
#[test]
fn a_pair_paid_for_by_a_late_exchange_is_warned_on_both_lines() {
    let findings = findings_with_cedric(
        "EXCHANGE 900 1 HORS 1 WOOD\nEXCHANGE 1160 1 WOOD 1 SILV",
        "EXCHANGE 683 1 SILV 1 WOOD",
        "EXCHANGE 683 1 WOOD 1 HORS",
    );
    let messages: Vec<(&str, &str)> = findings
        .iter()
        .map(|finding| {
            (
                finding.unit_id.as_deref().unwrap_or(""),
                finding.message.as_str(),
            )
        })
        .collect();
    let late = "EXCHANGE will be aborted: Ivanhoe (683) will hold only 0 of the 1 WOOD it offers — \
                the WOOD from Cedric (900) arrives after this exchange is settled";
    assert_eq!(messages, vec![("683", late), ("1160", late)]);
}
