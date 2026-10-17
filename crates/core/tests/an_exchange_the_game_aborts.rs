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
        "- Mark (7001), Bar (2), 5 orcs [ORC], 900 silver [SILV], 4 swords [SWOR].",
        "",
    ]
    .join("\n")
}

fn findings_of(ivanhoe: &str, maurice: &str) -> Vec<Finding> {
    let ruleset = ruleset();
    let text = report_text();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let script = format!("{template}\nunit 683\n{ivanhoe}\nunit 1160\n{maurice}\n");
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
