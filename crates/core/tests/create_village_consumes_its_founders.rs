//! `ah-mw1r.3`. `CREATE VILLAGE` consumes the people and the wagons that found it.
//!
//! `newage trident rules/create_village`: *"The unit must have at least 1000 people (men or
//! leaders) and 100 wagons; all of these are consumed when the village is created. This is a
//! month-long order."* `newage trident rules/sequenceofevents` runs *"CREATE orders are processed"*
//! after PRODUCE and before ENTERTAIN, and assesses maintenance after both, so the founders pay no
//! upkeep. The navigator's description of `ah-mw1r` (2026-10-09) reads it as consuming "1000 men or
//! leaders and 100 wagons".
//! Trident only: `grammar.rs` offers CREATE under no other ruleset.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, ItemChangeCause};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::trident_ruleset;

/// Settlers (900) with 1005 orcs and 102 wagons, enough silver to pay any upkeep, and the
/// carpenter's skill and wood to make wagons instead; Stragglers (901) one orc short of founding.
fn report_text() -> String {
    report_in("plain (1,1) in Nowhere, 10 peasants (orcs), $5.")
}

/// The same two units, standing in `region`.
fn report_in(region: &str) -> String {
    [
        "Foo (1) Report",
        "",
        region,
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Settlers (900), Foo (1), 1005 orcs [ORC], 102 wagons [WAGO], 20 wood [WOOD], 20000 \
         silver [SILV]. Weight: 10000. Capacity: 0/0/15075/0. Skills: carpenter [CARP] 1 (30).",
        "* Stragglers (901), Foo (1), 999 orcs [ORC], 100 wagons [WAGO], 20000 silver [SILV]. \
         Weight: 10000. Capacity: 0/0/15000/0.",
        "",
    ]
    .join("\n")
}

fn script_for(settlers: &str, stragglers: &str) -> String {
    let text = report_text();
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let template = common::without_standing_month_orders(&template, &["900", "901"]);
    format!("{template}\nunit 900\n{settlers}\nunit 901\n{stragglers}\n")
}

fn silver_row(settlers: &str, stragglers: &str, unit_id: &str) -> UnitSilver {
    let ruleset = trident_ruleset();
    let mut parsed = parse_report_full(&report_text());
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &script_for(settlers, stragglers),
        Some(&ruleset),
        CheckOptions::default(),
    )
    .silver
    .into_iter()
    .find(|row| row.unit_id == unit_id)
    .expect("the column has a row for the unit")
}

/// What the ITEMS preview leaves `unit_id` holding of `tag` before upkeep, or `unchanged` when the
/// orders change nothing the preview shows about the unit.
fn held(settlers: &str, stragglers: &str, unit_id: &str, tag: &str, unchanged: i64) -> i64 {
    held_in(
        &report_text(),
        settlers,
        stragglers,
        unit_id,
        tag,
        unchanged,
    )
}

fn held_in(
    text: &str,
    settlers: &str,
    stragglers: &str,
    unit_id: &str,
    tag: &str,
    unchanged: i64,
) -> i64 {
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        text,
        "[]",
        &script_for(settlers, stragglers),
    )
    .expect("the Trident ruleset loads");
    common::preview_row(text, &preview, unit_id)
        .map_or(unchanged, |unit| common::held_before_upkeep(unit, tag))
}

const CREATE: &str = "CREATE VILLAGE \"New Hope\"";

#[test]
fn the_founders_and_their_wagons_leave_the_items_preview() {
    assert_eq!(
        held(CREATE, "", "900", "ORC", 1005),
        5,
        "1000 orcs found it"
    );
    assert_eq!(held(CREATE, "", "900", "WAGO", 102), 2, "100 wagons go too");
    assert_eq!(
        held(CREATE, "", "900", "WOOD", 20),
        20,
        "nothing else is touched"
    );
}

#[test]
fn the_consumption_is_listed_as_founding_the_village() {
    let text = report_text();
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        &text,
        "[]",
        &script_for(CREATE, ""),
    )
    .expect("the Trident ruleset loads");
    let unit = common::expect_preview_row(&text, &preview, "900");
    let founded: Vec<(&str, i64)> = unit
        .item_changes
        .iter()
        .filter(|change| change.cause == ItemChangeCause::CreateSpent)
        .map(|change| (change.tag.as_str(), change.delta))
        .collect();
    assert_eq!(founded, vec![("ORC", -1000), ("WAGO", -100)]);
}

#[test]
fn the_founders_pay_no_upkeep() {
    let before = silver_row("", "", "900");
    let after = silver_row(CREATE, "", "900");
    assert_eq!(before.upkeep, Some(10050), "{before:?}");
    assert_eq!(
        after.upkeep,
        Some(50),
        "only the five who stay are fed: {after:?}"
    );
}

#[test]
fn a_unit_short_of_founders_founds_nothing_and_keeps_everyone() {
    assert_eq!(held("", CREATE, "901", "ORC", 999), 999);
    assert_eq!(held("", CREATE, "901", "WAGO", 100), 100);
    let row = silver_row("", CREATE, "901");
    assert_eq!(row.upkeep, Some(9990), "{row:?}");
}

/// A later month-long order replaces an earlier one, and CREATE is one of them
/// (`newage trident rules/create_village`: "This is a month-long order").
#[test]
fn create_replaces_an_earlier_month_long_order() {
    let produce_then_create = format!("PRODUCE wagon\n{CREATE}");
    assert_eq!(
        held(&produce_then_create, "", "900", "WAGO", 102),
        2,
        "no wagons are made; the founding runs"
    );
    assert_eq!(held(&produce_then_create, "", "900", "ORC", 1005), 5);

    let create_then_produce = format!("{CREATE}\nPRODUCE wagon");
    assert_eq!(
        held(&create_then_produce, "", "900", "ORC", 1005),
        1005,
        "the founding is replaced, so nobody leaves"
    );
}

/// `newage trident rules/create_village`: "the region must have no existing settlement, must not be
/// ocean, lake, volcano, or barren terrain". Where the report shows either, nothing is founded and
/// nobody leaves.
#[test]
fn a_region_the_rule_refuses_founds_nothing() {
    for region in [
        "plain (1,1) in Nowhere, contains Bigtown [city], 10 peasants (orcs), $5.",
        "ocean (1,1) in Atlantis Ocean.",
    ] {
        let text = report_in(region);
        assert_eq!(
            held_in(&text, CREATE, "", "900", "ORC", 1005),
            1005,
            "{region}"
        );
        assert_eq!(
            held_in(&text, CREATE, "", "900", "WAGO", 102),
            102,
            "{region}"
        );
    }
}
