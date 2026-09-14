//! The Problems panel and the map trace refuse the same step of a written `SAIL` (`ah-csb8`).
//!
//! Both surfaces judge a step with one function; these tests pin that they agree over hand-built
//! reports, so a sailing sentence extended for one surface cannot silently leave the other behind.
//!
//! `rules/movement_sailing`: *"A fleet can move from an ocean region to another ocean region, or
//! from a coastal region to an ocean region, or from an ocean region to a coastal region. Ships may
//! not sail through single hex land masses and must leave via the same side they entered or a side
//! adjacent to that one."* `newage trident rules/economy_canals`: *"When a Canal is present, ships
//! may sail through the region in any direction"*.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::report::parse_report_full;

mod common;
use common::{ruleset, trident_ruleset};

const ORDERS: &str = "unit 900\nSAIL SE SE\n";

/// A fleet at sea NW of a one-hex plain, with ocean beyond it. A copy of `movement/trace/isthmus.rs`'s
/// `neck_report`: integration test files share no private helpers.
fn neck_report(structure: &str) -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str("+ Ship [329] : Longship; Load: 0/150; Sailors: 4/4; MaxSpeed: 4.\n");
    text.push_str(
        "  * Sailors (900), Foo (1), leader [LEAD], sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n",
    );
    text.push_str(
        "  * Sailors (901), Foo (1), sharing, centaur [CTAU]. Weight: 50. \
         Capacity: 0/70/70/0. Skills: sailing [SAIL] 2 (90).\n\n",
    );
    text.push_str("plain (2,2) in Coast, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : ocean (1,1) in Sea.\n  North : ocean (2,0) in Sea.\n  \
         Southeast : ocean (3,3) in Sea.\n\n",
    );
    text.push_str(structure);
    if !structure.is_empty() {
        text.push('\n');
    }
    text.push_str("ocean (3,3) in Sea.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n\n");
    text.push_str("ocean (2,0) in Sea.\n\n");
    text.push_str("Exits:\n  South : plain (2,2) in Coast.\n");
    text
}

/// The same neck, but the hex SE of the plain is a plain too: the second step is land to land.
fn land_to_land_report() -> String {
    neck_report("")
        .replace(
            "Southeast : ocean (3,3) in Sea.",
            "Southeast : plain (3,3) in Coast.",
        )
        .replace("ocean (3,3) in Sea.\n", "plain (3,3) in Coast.\n")
}

fn review(text: &str, ruleset: &Ruleset) -> TurnReview {
    review_turn(
        &parse_report_full(text),
        ORDERS,
        Some(ruleset),
        CheckOptions::default(),
    )
}

fn trace(ruleset_json: &str, text: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset_json,
        text,
        "[]",
        "900",
        ORDERS,
    )
    .expect("the ruleset loads")
}

fn messages(review: &TurnReview, code: &str) -> Vec<String> {
    review
        .findings
        .iter()
        .filter(|finding| finding.code.as_str() == code)
        .map(|finding| finding.message.clone())
        .collect()
}

#[test]
fn a_neck_is_refused_by_the_panel_on_the_step_the_trace_dots() {
    let text = neck_report("");

    assert_eq!(
        messages(&review(&text, &ruleset()), "sail-through-neck-of-land"),
        vec![
            "a fleet must leave a land hex by the side it entered or one beside it: SE enters \
             plain (2,2) from the NW and SE is neither that side nor beside it, so it will not move"
                .to_string()
        ]
    );
    let path = trace(atlantis_hud_fixtures::RULESET_JSON, &text)
        .path
        .expect("a traced path");
    assert_eq!(path.blocked_from, Some(1));
}

#[test]
fn a_canal_silences_the_panel_and_leaves_the_trace_solid() {
    let text = neck_report("+ The Cut [3] : Canal.\n");

    assert!(messages(
        &review(&text, &trident_ruleset()),
        "sail-through-neck-of-land"
    )
    .is_empty());
    let path = trace(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON, &text)
        .path
        .expect("a traced path");
    assert_eq!(path.blocked_from, None);
}

#[test]
fn a_land_to_land_step_is_refused_by_both_on_the_same_step() {
    let text = land_to_land_report();
    let review = review(&text, &ruleset());

    assert_eq!(
        messages(&review, "sail-between-land-hexes"),
        vec![
            "a fleet may only sail where one end of the step is water: SE leaves plain (2,2) for \
             plain (3,3), so it will not move"
                .to_string()
        ]
    );
    assert!(messages(&review, "sail-through-neck-of-land").is_empty());
    let path = trace(atlantis_hud_fixtures::RULESET_JSON, &text)
        .path
        .expect("a traced path");
    assert_eq!(path.blocked_from, Some(1));
}
