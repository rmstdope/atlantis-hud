//! `ah-jgym`. An `EXCHANGE` pair the game aborts because a side is short of what it offers is
//! warned on both its lines even when that side also wrote an `EXCHANGE` line the game aborts
//! anyway.
//!
//! `rules/exchange`: *"If either unit involved does not have the items it is offering, or if the
//! exchange orders given are not complementary, the exchange is aborted. Men may not be
//! exchanged."* A line with no complementary answer, or one trading men, moves nothing, so it
//! cannot hand the short side what it lacks.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::{classify_units, parse_report_full};

use crate::common;
use common::ruleset;

const CODE: &str = "exchange-aborted";

/// The aborted-exchange warnings on the committed turn 42, as (unit, line, message).
fn warnings(script: &str) -> Vec<(String, usize, String)> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, script, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code.as_str() == CODE)
        .map(|finding| {
            (
                finding.unit_id.unwrap_or_default(),
                finding.line.unwrap_or_default(),
                finding.message,
            )
        })
        .collect()
}

/// Tundra (35,9) lists Scout (1170), City Guard (7676) and Miners (11127); Scout holds no iron
/// (`neworigins-3.0.0-g3-f42-t42.rep:2114`). `first` is Scout's first order, `miners` the Miners'.
fn script(first: &str, miners: &str) -> String {
    format!(
        "#atlantis 42 \"<password>\"\n\n\
         unit 1170\n{first}\nEXCHANGE 7676 1 IRON 1 SILV\n\
         unit 7676\nEXCHANGE 1170 1 SILV 1 IRON\n\
         unit 11127\n{miners}\n"
    )
}

const SHORT: &str =
    "EXCHANGE will be aborted: Scout (1170) will hold only 0 of the 1 IRON it offers";

/// The bead's case: Miners write nothing, so Scout's first line is unanswered and moves no iron.
#[test]
fn the_beads_case_warns_the_short_pair_beside_the_unanswered_line() {
    assert_eq!(
        warnings(&script("EXCHANGE 11127 1 SWOR 1 IRON", "")),
        vec![
            (
                "1170".to_string(),
                4,
                "EXCHANGE will be aborted: Miners (11127) has no EXCHANGE answering it".to_string()
            ),
            ("1170".to_string(), 5, SHORT.to_string()),
            ("7676".to_string(), 7, SHORT.to_string()),
        ]
    );
}

/// A line trading men is aborted whatever its partner writes, so it moves no iron either.
#[test]
fn a_refused_line_trading_the_item_does_not_hide_it() {
    let found = warnings(&script(
        "EXCHANGE 11127 1 LEAD 1 IRON",
        "EXCHANGE 1170 1 IRON 1 LEAD",
    ));
    assert!(
        found.contains(&("1170".to_string(), 5, SHORT.to_string()))
            && found.contains(&("7676".to_string(), 7, SHORT.to_string())),
        "{found:?}"
    );
}

/// Where the partner wrote an `EXCHANGE` with another faction's new unit, which may be Scout,
/// whether Scout's first line is answered - and so whether iron arrives - cannot be said, and the
/// warning stays silent: a missed warning, never a false one. The Miners' line trades no iron, so
/// only Scout's own first line could be what silences it.
#[test]
fn an_unanswered_line_whose_partner_may_answer_as_another_factions_new_unit_still_silences_it() {
    let found = warnings(&script(
        "EXCHANGE 11127 1 SWOR 1 IRON",
        "EXCHANGE FACTION 2 NEW 1 1 SWOR 1 WOOD",
    ));
    assert!(
        !found.iter().any(|(_, _, message)| message == SHORT),
        "{found:?}"
    );
}
