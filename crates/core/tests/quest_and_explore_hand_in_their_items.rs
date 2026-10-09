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
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, ItemChangeCause, UnitPreview,
};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::trident_ruleset;

const TRIDENT: &str = atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON;
const ARCANUM: &str = atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON;

/// A village with a finished Town Hall, where `rules/quest` turns tokens in.
const TOWN: &str = "plain (1,1) in Nowhere, contains Hope [village], 10 peasants (orcs), $5.";
const TOWN_HALL: &str = "+ Hall [1] : Town Hall.";
/// No settlement and no hall.
const SURFACE: &str = "plain (1,1) in Nowhere, 10 peasants (orcs), $5.";
const UNDERWORLD: &str = "tunnels (1,1,2 <underworld>) in Deepdark, 10 peasants (orcs), $5.";

/// Seeker (900), a one-man unit carrying five bounty tokens, a resource map and a treasure map;
/// Courier (901) of ours with two more tokens; and Mark (7001), another faction's, with three.
fn report_in(region: &str) -> String {
    let structures = if region == TOWN { TOWN_HALL } else { "" };
    [
        "Foo (1) Report",
        "",
        region,
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Seeker (900), Foo (1), orc [ORC], 5 bounty tokens [BNTY], resource map [RMAP], treasure \
         map [TMAP], 100 silver [SILV]. Weight: 13. Capacity: 0/0/15/0. Skills: stealth [STEA] 1 \
         (30).",
        "* Courier (901), Foo (1), orc [ORC], 2 bounty tokens [BNTY], 100 silver [SILV]. Weight: \
         12. Capacity: 0/0/15/0.",
        "- Mark (7001), Bar (2), orc [ORC], 3 bounty tokens [BNTY].",
        "",
        structures,
        "",
    ]
    .join("\n")
}

fn script_for(text: &str, seeker: &str, courier: &str) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let template = common::without_standing_month_orders(&template, &["900", "901"]);
    format!("{template}\nunit 900\n{seeker}\nunit 901\nWORK\n{courier}\n")
}

fn preview_with(
    ruleset: &str,
    region: &str,
    seeker: &str,
    courier: &str,
    read: impl FnOnce(&str, &atlantis_hud_core::orders::effects::OrdersPreviewResponse) -> Seeker,
) -> Seeker {
    let text = report_in(region);
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset,
        &text,
        "[]",
        &script_for(&text, seeker, courier),
    )
    .expect("the ruleset loads");
    read(&text, &preview)
}

/// What the ITEMS preview shows for Seeker.
struct Seeker {
    items: Vec<(String, i64)>,
    uncounted: Vec<String>,
    changes: Vec<(ItemChangeCause, String, i64)>,
}

impl Seeker {
    fn from(unit: &UnitPreview) -> Self {
        Seeker {
            items: ["BNTY", "RMAP", "TMAP"]
                .iter()
                .map(|tag| (tag.to_string(), common::held_before_upkeep(unit, tag)))
                .collect(),
            uncounted: unit.uncounted.clone(),
            changes: unit
                .item_changes
                .iter()
                .map(|change| (change.cause, change.tag.clone(), change.delta))
                .collect(),
        }
    }

    /// The report's own holdings, for a unit the orders leave alone.
    fn unchanged() -> Self {
        Seeker {
            items: vec![
                ("BNTY".to_string(), 5),
                ("RMAP".to_string(), 1),
                ("TMAP".to_string(), 1),
            ],
            uncounted: Vec::new(),
            changes: Vec::new(),
        }
    }

    fn held(&self, tag: &str) -> i64 {
        self.items
            .iter()
            .find(|(held, _)| held == tag)
            .map_or(0, |(_, amount)| *amount)
    }

    fn spent(&self, cause: ItemChangeCause) -> Vec<(String, i64)> {
        self.changes
            .iter()
            .filter(|(of, _, _)| *of == cause)
            .map(|(_, tag, delta)| (tag.clone(), *delta))
            .collect()
    }
}

/// Seeker's preview, for orders that are known to change it: a missing row fails.
fn seeker(ruleset: &str, region: &str, order: &str, courier: &str) -> Seeker {
    preview_with(ruleset, region, order, courier, |text, preview| {
        Seeker::from(common::expect_preview_row(text, preview, "900"))
    })
}

/// Seeker's preview, where the orders may leave it alone and so give it no row.
fn seeker_if_changed(ruleset: &str, region: &str, order: &str) -> Seeker {
    preview_with(ruleset, region, order, "", |text, preview| {
        common::preview_row(text, preview, "900").map_or_else(Seeker::unchanged, Seeker::from)
    })
}

fn findings(region: &str, order: &str) -> Vec<Finding> {
    let ruleset = trident_ruleset();
    let text = report_in(region);
    let mut parsed = parse_report_full(&text);
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &script_for(&text, order, ""),
        Some(&ruleset),
        CheckOptions::default(),
    )
    .findings
}

#[test]
fn explore_rmap_consumes_the_map() {
    let seeker = seeker(TRIDENT, SURFACE, "EXPLORE RMAP", "");
    assert_eq!(seeker.held("RMAP"), 0, "consumed when the order executes");
    assert!(seeker.uncounted.is_empty(), "{:?}", seeker.uncounted);
    assert_eq!(
        seeker.spent(ItemChangeCause::ExploreSpent),
        vec![("RMAP".to_string(), -1)]
    );
    assert_eq!(seeker.held("TMAP"), 1, "the other map is not touched");
}

#[test]
fn quest_with_discount_hands_in_the_tokens_it_names() {
    let order = "QUEST 3 DISCOUNT";
    let seeker = seeker(TRIDENT, TOWN, order, "");
    assert_eq!(seeker.held("BNTY"), 2);
    assert_eq!(
        seeker.spent(ItemChangeCause::QuestSpent),
        vec![("BNTY".to_string(), -3)]
    );
    assert_eq!(
        seeker.uncounted,
        vec![order.to_string()],
        "the reward is a random item, so the line is admitted"
    );
}

#[test]
fn quest_with_discount_is_capped_by_the_tokens_the_unit_carries() {
    let seeker = seeker(TRIDENT, TOWN, "QUEST 8 EQUIPMENT DISCOUNT", "");
    assert_eq!(seeker.held("BNTY"), 0);
    assert_eq!(
        seeker.spent(ItemChangeCause::QuestSpent),
        vec![("BNTY".to_string(), -5)]
    );
}

#[test]
fn quest_with_discount_and_no_count_hands_in_one_token() {
    let seeker = seeker(TRIDENT, TOWN, "QUEST DISCOUNT", "");
    assert_eq!(
        seeker.held("BNTY"),
        4,
        "if omitted, exactly 1 token is spent"
    );
}

/// `rules/sequenceofevents` runs GIVE before QUEST, so tokens handed over this month count.
#[test]
fn tokens_given_earlier_in_the_turn_are_handed_in_too() {
    let seeker = seeker(TRIDENT, TOWN, "QUEST 7 DISCOUNT", "GIVE 900 2 BNTY");
    assert_eq!(seeker.held("BNTY"), 0);
    assert_eq!(
        seeker.spent(ItemChangeCause::QuestSpent),
        vec![("BNTY".to_string(), -7)]
    );
}

/// A STEAL of tokens leaves how many Seeker holds unknowable, so none are taken (`ah-mw1r.1`).
#[test]
fn an_uncertain_holding_hands_in_nothing_and_is_uncounted() {
    let seeker = seeker(TRIDENT, TOWN, "STEAL 7001 BNTY\nQUEST 2 DISCOUNT", "");
    assert_eq!(seeker.held("BNTY"), 5);
    assert!(seeker.spent(ItemChangeCause::QuestSpent).is_empty());
    assert!(
        seeker.uncounted.contains(&"QUEST 2 DISCOUNT".to_string()),
        "{:?}",
        seeker.uncounted
    );
}

/// `rules/quest`: "The unit must be in a region that has an active Town Hall".
#[test]
fn quest_without_a_town_hall_hands_in_nothing() {
    let seeker = seeker_if_changed(TRIDENT, SURFACE, "QUEST 3 DISCOUNT");
    assert_eq!(seeker.held("BNTY"), 5);
    assert!(seeker.uncounted.is_empty(), "{:?}", seeker.uncounted);
}

#[test]
fn quest_without_discount_keeps_the_tokens_and_is_uncounted() {
    let seeker = seeker(TRIDENT, TOWN, "QUEST 3", "");
    assert_eq!(
        seeker.held("BNTY"),
        5,
        "tokens not covered by bounty owed stay with the unit"
    );
    assert_eq!(seeker.uncounted, vec!["QUEST 3".to_string()]);
    assert!(seeker.spent(ItemChangeCause::QuestSpent).is_empty());
}

/// `newage arcanum rules/quest` has no DISCOUNT, so the word is trailing text there.
#[test]
fn arcanum_has_no_discount_and_keeps_the_tokens() {
    let seeker = seeker(ARCANUM, TOWN, "QUEST 3 DISCOUNT", "");
    assert_eq!(seeker.held("BNTY"), 5);
    assert_eq!(seeker.uncounted, vec!["QUEST 3 DISCOUNT".to_string()]);
}

#[test]
fn explore_tmap_keeps_the_map_and_is_uncounted() {
    let seeker = seeker(TRIDENT, SURFACE, "EXPLORE TMAP", "");
    assert_eq!(
        seeker.held("TMAP"),
        1,
        "consumed only on success, and on half the failures"
    );
    assert_eq!(seeker.uncounted, vec!["EXPLORE TMAP".to_string()]);
    assert!(seeker.spent(ItemChangeCause::ExploreSpent).is_empty());
    let surface = findings(SURFACE, "EXPLORE TMAP");
    assert!(surface.is_empty(), "{surface:?}");
}

#[test]
fn explore_tmap_below_the_surface_is_warned_and_keeps_the_map() {
    let findings = findings(UNDERWORLD, "EXPLORE TMAP");
    assert_eq!(
        findings
            .iter()
            .map(|finding| finding.code.as_str())
            .collect::<Vec<_>>(),
        vec!["explore-below-the-surface"],
        "{findings:?}"
    );
    let seeker = seeker_if_changed(TRIDENT, UNDERWORLD, "EXPLORE TMAP");
    assert_eq!(seeker.held("TMAP"), 1);
    assert!(
        seeker.uncounted.is_empty(),
        "the order cannot run, so the map certainly stays: {:?}",
        seeker.uncounted
    );
}
