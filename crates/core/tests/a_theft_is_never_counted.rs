//! `ah-mw1r.1`. A `STEAL` leaves the thief's month uncountable rather than certain.
//!
//! `rules/steal`: *"Attempt to steal as much as possible of the specified item from the specified
//! unit. The order may only be issued by a one-man unit. A unit may only attempt to steal from a
//! unit which is able to be seen."* Whether anything arrives is dice and the target's stock, so the
//! navigator settled (2026-10-09, on `ah-mw1r`) that nothing is added to the thief: the line is
//! listed as uncounted on its ITEMS cell, and a theft of silver doubts its SILVER column.
//! `rules/sequenceofevents` runs STEAL under *Subterfuge orders*, before *Give orders*.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::{SilverDoubt, UnitSilver};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One hex: a one-man thief of ours, a unit of ours to hand the loot to, and a foreign unit the
/// thief can see holding silver and swords.
fn report_text() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Thief (2391), Foo (1), orc [ORC], 100 silver [SILV]. Weight: 10. \
         Capacity: 0/0/15/0. Skills: stealth [STEA] 3 (180).",
        "* Fence (2392), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "- Mark (7001), Bar (2), 5 orcs [ORC], 900 silver [SILV], 4 swords [SWOR].",
        "",
    ]
    .join("\n")
}

fn script_for(order: &str) -> String {
    let text = report_text();
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 2391\n{order}\nunit 2392\n")
}

fn review_of(order: &str) -> TurnReview {
    let ruleset = ruleset();
    let text = report_text();
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &script_for(order),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

fn thief_silver(order: &str) -> UnitSilver {
    review_of(order)
        .silver
        .iter()
        .find(|row| row.unit_id == "2391")
        .expect("the column has a row for the thief")
        .clone()
}

/// What the ITEMS preview leaves the thief holding of `tag`, and what it admitted as uncounted.
///
/// No row at all means the orders changed nothing the preview shows, so the report's own holding
/// (`unchanged`) stands and nothing is admitted.
fn thief_preview(order: &str, tag: &str, unchanged: i64) -> (i64, Vec<String>) {
    preview_of(order, "2391", tag, unchanged)
}

/// [`thief_preview`] for any unit of ours.
fn preview_of(order: &str, unit_id: &str, tag: &str, unchanged: i64) -> (i64, Vec<String>) {
    let text = report_text();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &script_for(order),
    )
    .expect("the committed ruleset loads");
    let Some(unit) = common::preview_row(&text, &preview, unit_id) else {
        return (unchanged, Vec::new());
    };
    (
        unit.unit
            .items
            .iter()
            .filter(|item| item.tag == tag)
            .map(|item| item.amount)
            .sum(),
        unit.uncounted.clone(),
    )
}

#[test]
fn a_theft_of_silver_is_uncounted_and_doubts_the_silver_column() {
    let order = "STEAL 7001 SILV";
    let (silver, uncounted) = thief_preview(order, "SILV", 100);
    assert_eq!(silver, 100, "nothing is added to the thief");
    assert_eq!(uncounted, vec![order.to_string()], "the line reads `+ ?`");

    let thief = thief_silver(order);
    assert_eq!(
        thief.doubt,
        Some(SilverDoubt::StealUncertain),
        "what the theft brings in cannot be said: {thief:?}"
    );
}

#[test]
fn a_theft_of_goods_is_uncounted_and_leaves_the_silver_column_priced() {
    let order = "STEAL 7001 SWOR";
    let (swords, uncounted) = thief_preview(order, "SWOR", 0);
    assert_eq!(swords, 0, "nothing is added to the thief");
    assert_eq!(uncounted, vec![order.to_string()], "the line reads `+ ?`");

    let thief = thief_silver(order);
    assert_eq!(thief.doubt, None, "a sword is not silver: {thief:?}");
}

/// The control: without the theft nothing is uncounted, so the cases above are not passing on a
/// fixture that is uncountable for some other reason.
#[test]
fn without_the_theft_nothing_is_uncounted() {
    let (_, uncounted) = thief_preview("", "SILV", 100);
    assert!(uncounted.is_empty(), "{uncounted:?}");
    assert_eq!(thief_silver("").doubt, None);
}

/// What a theft brings in cannot be handed on as a number either: a later `GIVE` of the stolen
/// goods may move some, all or none of them, so the receiver reads `+ ?` and nothing is called
/// short (reviewer's finding on PR #1469).
#[test]
fn handing_on_stolen_goods_is_uncounted_on_both_ends() {
    let order = "STEAL 7001 SWOR\nGIVE 2392 4 SWOR";
    let (_, thief) = thief_preview(order, "SWOR", 0);
    assert_eq!(
        thief,
        vec![
            "STEAL 7001 SWOR".to_string(),
            "GIVE 2392 4 SWOR".to_string()
        ]
    );
    let (swords, fence) = preview_of(order, "2392", "SWOR", 0);
    assert_eq!(swords, 0, "nothing is credited as certain");
    assert_eq!(
        fence,
        vec!["GIVE 2392 4 SWOR".to_string()],
        "the receiver reads `+ ?`"
    );
}

/// `rules/steal`'s own example spells the item out - `STEAL 123 SILVER` - and the column doubts
/// that form as it does the tag.
#[test]
fn the_rules_own_spelling_of_silver_doubts_the_column_too() {
    let order = "STEAL 7001 SILVER";
    let (_, uncounted) = thief_preview(order, "SILV", 100);
    assert_eq!(uncounted, vec![order.to_string()]);
    assert_eq!(thief_silver(order).doubt, Some(SilverDoubt::StealUncertain));
}
