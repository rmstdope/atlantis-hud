//! `ah-mw1r.4`. `QUEST` and `EXPLORE` hand in the tokens and maps the rules say they consume.
//!
//! `newage trident rules/explore`: *"EXPLORE RMAP ... The map is consumed when the order executes,
//! even if the region has nothing to chart."* and *"EXPLORE TMAP ... The map is consumed only when a
//! hideout is actually placed ... A failed attempt destroys the map 50% of the time. This order can
//! only be used on the surface."*
//!
//! `newage trident rules/quest`: *"Without DISCOUNT, tokens not covered by bounty owed stay with the
//! unit."*, *"If omitted, exactly 1 token is spent. The actual number spent is capped by the tokens
//! your unit carries."* and, with DISCOUNT, *"tokens not covered by bounty owed are also accepted"*.
//!
//! `newage trident rules/sequenceofevents` runs QUEST after WITHDRAW and before Movement, and
//! EXPLORE after WORK, with the month-long orders. The navigator settled the scope on `ah-mw1r`
//! (2026-10-09): remove only what is certain to go - EXPLORE RMAP's map and QUEST n DISCOUNT's
//! tokens - and list QUEST without DISCOUNT and EXPLORE TMAP as uncounted.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, ItemChangeCause};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::trident_ruleset;

const SURFACE: &str = "plain (1,1) in Nowhere, 10 peasants (orcs), $5.";
const UNDERWORLD: &str = "tunnels (1,1,2 <underworld>) in Deepdark, 10 peasants (orcs), $5.";

/// Seeker (900) carries five bounty tokens, a resource map and a treasure map.
fn report_in(region: &str) -> String {
    [
        "Foo (1) Report",
        "",
        region,
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Seeker (900), Foo (1), orc [ORC], 5 bounty tokens [BNTY], resource map [RMAP], treasure \
         map [TMAP], 100 silver [SILV]. Weight: 13. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

fn script_for(text: &str, order: &str) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let template = common::without_standing_month_orders(&template, &["900"]);
    format!("{template}\nunit 900\n{order}\n")
}

/// What the ITEMS preview leaves Seeker holding of `tag` before upkeep, what it lists uncounted,
/// and every item change `cause` recorded, as `(tag, delta)`.
fn seeker(
    region: &str,
    order: &str,
    tag: &str,
    unchanged: i64,
    cause: ItemChangeCause,
) -> (i64, Vec<String>, Vec<(String, i64)>) {
    let text = report_in(region);
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &text,
        "[]",
        &script_for(&text, order),
    )
    .expect("the Trident ruleset loads");
    let Some(unit) = common::preview_row(&text, &preview, "900") else {
        return (unchanged, Vec::new(), Vec::new());
    };
    (
        common::held_before_upkeep(unit, tag),
        unit.uncounted.clone(),
        unit.item_changes
            .iter()
            .filter(|change| change.cause == cause)
            .map(|change| (change.tag.clone(), change.delta))
            .collect(),
    )
}

fn findings(region: &str, order: &str) -> Vec<Finding> {
    let ruleset = trident_ruleset();
    let text = report_in(region);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &script_for(&text, order),
        Some(&ruleset),
        CheckOptions::default(),
    )
    .findings
}

#[test]
fn explore_rmap_consumes_the_map() {
    let (maps, uncounted, spent) = seeker(
        SURFACE,
        "EXPLORE RMAP",
        "RMAP",
        1,
        ItemChangeCause::ExploreSpent,
    );
    assert_eq!(maps, 0, "the map is consumed when the order executes");
    assert!(uncounted.is_empty(), "{uncounted:?}");
    assert_eq!(spent, vec![("RMAP".to_string(), -1)]);
    let (treasure, _, _) = seeker(
        SURFACE,
        "EXPLORE RMAP",
        "TMAP",
        1,
        ItemChangeCause::ExploreSpent,
    );
    assert_eq!(treasure, 1, "the other map is not touched");
}

#[test]
fn quest_with_discount_hands_in_the_tokens_it_names() {
    let (tokens, uncounted, spent) = seeker(
        SURFACE,
        "QUEST 3 DISCOUNT",
        "BNTY",
        5,
        ItemChangeCause::QuestSpent,
    );
    assert_eq!(tokens, 2);
    assert!(uncounted.is_empty(), "{uncounted:?}");
    assert_eq!(spent, vec![("BNTY".to_string(), -3)]);
}

#[test]
fn quest_with_discount_is_capped_by_the_tokens_the_unit_carries() {
    let (tokens, _, spent) = seeker(
        SURFACE,
        "QUEST 8 EQUIPMENT DISCOUNT",
        "BNTY",
        5,
        ItemChangeCause::QuestSpent,
    );
    assert_eq!(tokens, 0);
    assert_eq!(spent, vec![("BNTY".to_string(), -5)]);
}

#[test]
fn quest_with_discount_and_no_count_hands_in_one_token() {
    let (tokens, _, _) = seeker(
        SURFACE,
        "QUEST DISCOUNT",
        "BNTY",
        5,
        ItemChangeCause::QuestSpent,
    );
    assert_eq!(tokens, 4, "if omitted, exactly 1 token is spent");
}

#[test]
fn quest_without_discount_keeps_the_tokens_and_is_uncounted() {
    let (tokens, uncounted, spent) =
        seeker(SURFACE, "QUEST 3", "BNTY", 5, ItemChangeCause::QuestSpent);
    assert_eq!(
        tokens, 5,
        "tokens not covered by bounty owed stay with the unit"
    );
    assert_eq!(uncounted, vec!["QUEST 3".to_string()]);
    assert!(spent.is_empty(), "{spent:?}");
}

#[test]
fn explore_tmap_keeps_the_map_and_is_uncounted() {
    let (maps, uncounted, spent) = seeker(
        SURFACE,
        "EXPLORE TMAP",
        "TMAP",
        1,
        ItemChangeCause::ExploreSpent,
    );
    assert_eq!(
        maps, 1,
        "consumed only on success, and on half the failures"
    );
    assert_eq!(uncounted, vec!["EXPLORE TMAP".to_string()]);
    assert!(spent.is_empty(), "{spent:?}");
    let surface = findings(SURFACE, "EXPLORE TMAP");
    assert!(surface.is_empty(), "{surface:?}");
}

#[test]
fn explore_tmap_below_the_surface_is_warned() {
    let findings = findings(UNDERWORLD, "EXPLORE TMAP");
    assert_eq!(
        findings
            .iter()
            .map(|finding| finding.code.as_str())
            .collect::<Vec<_>>(),
        vec!["explore-below-the-surface"],
        "{findings:?}"
    );
}
