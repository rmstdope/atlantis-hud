//! Food that maintenance eats leaves the ITEMS column exactly as the SILVER column spent it
//! (`ah-q490`).
//!
//! `rules/economy_maintenance` pays maintenance in this order: *"Food items the unit owns if the
//! unit is set CONSUME UNIT or CONSUME FACTION"*, then *"Food items from faction units in the same
//! region if the unit is set CONSUME FACTION"*, then silver, then *"Food items in the unit's
//! possession"*. It also says a unit *"may substitute one unit of grain, livestock, fish or meals
//! for each 50 silver (or fraction thereof) of maintenance owed"* - so ten men owing 10 silver each
//! (`rules/economy_maintenance`: *"generally 10 silver for a normal character"*) eat two grain.
//!
//! `rules/sequenceofevents`: *"Maintenance costs are assessed"* last of all, and *"units that
//! appear higher on the report get precedence"* - which is whose grain the faction pool gives up
//! first.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, ItemChangeCause, UnitPreview,
};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::UnitSilver;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

/// One quiet hex - no tax base, no wages worth having - holding the units the caller names.
fn report(units: &[&str]) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : plain (2,2) in Nowhere.".to_string(),
        String::new(),
    ];
    lines.extend(units.iter().map(|unit| (*unit).to_string()));
    lines.push(String::new());
    lines.join("\n")
}

fn document(text: &str, script: &str) -> String {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\n{script}")
}

fn review_of(text: &str, script: &str) -> TurnReview {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    review_turn(
        &parsed,
        &document(text, script),
        Some(&ruleset),
        CheckOptions::default(),
    )
}

fn silver_of(review: &TurnReview, unit_id: &str) -> UnitSilver {
    review
        .silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("the column has a row for unit {unit_id}"))
        .clone()
}

fn preview_row(text: &str, script: &str, unit_id: &str) -> UnitPreview {
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        &document(text, script),
    )
    .expect("the committed ruleset loads");
    common::expect_preview_row(text, &preview, unit_id).clone()
}

fn holding(row: &UnitPreview, tag: &str) -> i64 {
    row.unit
        .items
        .iter()
        .filter(|item| item.tag == tag)
        .map(|item| item.amount)
        .sum()
}

/// The ITEMS hover's entries for food eaten for upkeep, as `(tag, delta)`.
fn eaten(row: &UnitPreview) -> Vec<(String, i64)> {
    row.item_changes
        .iter()
        .filter(|change| change.cause == ItemChangeCause::EatenForUpkeep)
        .map(|change| (change.tag.clone(), change.delta))
        .collect()
}

/// `CONSUME UNIT`: the unit eats its own grain before its silver.
#[test]
fn a_unit_consuming_its_own_food_loses_the_grain_it_eats() {
    let text = report(&[
        "* Eaters (900), Foo (1), consuming unit's food, 10 orcs [ORC], 5 grain [GRAI], \
         100 silver [SILV]. Weight: 125. Capacity: 0/0/150/0.",
    ]);

    let silver = silver_of(&review_of(&text, ""), "900");
    assert_eq!(silver.own_food_covered, 100, "{silver:?}");

    let row = preview_row(&text, "", "900");
    assert_eq!(holding(&row, "GRAI"), 3, "{:?}", row.unit.items);
    assert_eq!(eaten(&row), vec![("GRAI".to_string(), -2)]);
}

/// `CONSUME FACTION`: the eater takes the grain its faction-mate holds, and it is the holder's
/// ITEMS that lose it.
#[test]
fn faction_food_is_subtracted_from_the_unit_that_held_it() {
    let text = report(&[
        "* Granary (900), Foo (1), orc [ORC], 6 grain [GRAI], 10 silver [SILV]. Weight: 40. \
         Capacity: 0/0/15/0.",
        "* Eaters (901), Foo (1), consuming faction's food, 10 orcs [ORC]. Weight: 100. \
         Capacity: 0/0/150/0.",
    ]);

    let review = review_of(&text, "");
    assert_eq!(silver_of(&review, "901").faction_food_covered, 100);

    let granary = preview_row(&text, "", "900");
    assert_eq!(holding(&granary, "GRAI"), 4, "{:?}", granary.unit.items);
    assert_eq!(eaten(&granary), vec![("GRAI".to_string(), -2)]);
}

/// Step 5: a unit whose silver ran out eats its own food, flag or no flag.
#[test]
fn a_unit_out_of_silver_loses_the_food_it_is_made_to_eat() {
    let text = report(&[
        "* Poor (900), Foo (1), 10 orcs [ORC], 5 grain [GRAI]. Weight: 125. Capacity: 0/0/150/0.",
    ]);

    let silver = silver_of(&review_of(&text, ""), "900");
    assert_eq!(silver.forced_own_food, 2, "{silver:?}");

    let row = preview_row(&text, "", "900");
    assert_eq!(holding(&row, "GRAI"), 3, "{:?}", row.unit.items);
    assert_eq!(eaten(&row), vec![("GRAI".to_string(), -2)]);
}

/// Step 6: a unit whose silver ran out eats its faction-mate's food, and the holder loses it.
#[test]
fn a_unit_out_of_silver_eats_faction_food_from_its_holder() {
    let text = report(&[
        "* Granary (900), Foo (1), orc [ORC], 6 grain [GRAI], 10 silver [SILV]. Weight: 40. \
         Capacity: 0/0/15/0.",
        "* Poor (901), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0.",
    ]);

    let silver = silver_of(&review_of(&text, ""), "901");
    assert_eq!(silver.forced_faction_food, 2, "{silver:?}");

    let granary = preview_row(&text, "", "900");
    assert_eq!(holding(&granary, "GRAI"), 4, "{:?}", granary.unit.items);
    assert_eq!(eaten(&granary), vec![("GRAI".to_string(), -2)]);
}

/// Two holders: the one higher on the report gives up its grain first.
#[test]
fn the_pool_drains_holders_in_report_order() {
    let text = report(&[
        "* First (900), Foo (1), orc [ORC], grain [GRAI], 10 silver [SILV]. Weight: 15. \
         Capacity: 0/0/15/0.",
        "* Second (901), Foo (1), orc [ORC], 5 grain [GRAI], 10 silver [SILV]. Weight: 35. \
         Capacity: 0/0/15/0.",
        "* Eaters (902), Foo (1), consuming faction's food, 10 orcs [ORC]. Weight: 100. \
         Capacity: 0/0/150/0.",
    ]);

    assert_eq!(
        silver_of(&review_of(&text, ""), "902").faction_food_covered,
        100
    );

    let first = preview_row(&text, "", "900");
    assert_eq!(holding(&first, "GRAI"), 0, "{:?}", first.unit.items);
    assert_eq!(eaten(&first), vec![("GRAI".to_string(), -1)]);
    let second = preview_row(&text, "", "901");
    assert_eq!(holding(&second, "GRAI"), 4, "{:?}", second.unit.items);
    assert_eq!(eaten(&second), vec![("GRAI".to_string(), -1)]);
}

/// A unit that pays in silver keeps its food.
#[test]
fn a_unit_paying_in_silver_keeps_its_food() {
    let text = report(&[
        "* Paying (900), Foo (1), 10 orcs [ORC], 5 grain [GRAI], 100 silver [SILV]. \
         Weight: 125. Capacity: 0/0/150/0.",
    ]);

    let silver = silver_of(&review_of(&text, ""), "900");
    assert_eq!(silver.own_food_covered, 0, "{silver:?}");
    // The orders change nothing about this unit, so the preview may omit it - which is itself
    // "keeps its food".
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &document(&text, ""),
    )
    .expect("the committed ruleset loads");
    if let Some(row) = common::preview_row(&text, &preview, "900") {
        assert_eq!(holding(row, "GRAI"), 5);
        assert!(eaten(row).is_empty());
    }
}

/// Step 2 contended: two eaters want three grain and the hex holds two, so which one eats cannot
/// be told (the column doubts both). Only what each ate of its own at step 1 comes off.
#[test]
fn a_contended_pool_takes_only_the_eaters_own_food() {
    let text = report(&[
        "* Granary (900), Foo (1), orc [ORC], 2 grain [GRAI], 10 silver [SILV]. Weight: 20. \
         Capacity: 0/0/15/0.",
        "* First (901), Foo (1), consuming faction's food, 10 orcs [ORC], grain [GRAI]. \
         Weight: 105. Capacity: 0/0/150/0.",
        "* Second (902), Foo (1), consuming faction's food, 10 orcs [ORC]. Weight: 100. \
         Capacity: 0/0/150/0.",
    ]);

    let review = review_of(&text, "");
    assert_eq!(silver_of(&review, "901").own_food_covered, 50);
    assert_eq!(silver_of(&review, "901").upkeep, None, "contended");

    let first = preview_row(&text, "", "901");
    assert_eq!(holding(&first, "GRAI"), 0, "{:?}", first.unit.items);
    assert_eq!(eaten(&first), vec![("GRAI".to_string(), -1)]);

    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &text,
        "[]",
        &document(&text, ""),
    )
    .expect("the committed ruleset loads");
    if let Some(granary) = common::preview_row(&text, &preview, "900") {
        assert_eq!(holding(granary, "GRAI"), 2, "{:?}", granary.unit.items);
        assert!(eaten(granary).is_empty());
    }
}

/// Two foods of equal value (`data/GRAI`, `data/LIVE`): each tag comes off by what was eaten of it.
#[test]
fn each_food_comes_off_by_its_own_tag() {
    let text = report(&[
        "* Eaters (900), Foo (1), consuming unit's food, 10 orcs [ORC], grain [GRAI], \
         5 livestock [LIVE], 100 silver [SILV]. Weight: 355. Capacity: 0/0/150/0.",
    ]);

    assert_eq!(
        silver_of(&review_of(&text, ""), "900").own_food_covered,
        100
    );

    let row = preview_row(&text, "", "900");
    assert_eq!(holding(&row, "GRAI"), 0, "{:?}", row.unit.items);
    assert_eq!(holding(&row, "LIVE"), 4, "{:?}", row.unit.items);
    let mut got = eaten(&row);
    got.sort();
    assert_eq!(
        got,
        vec![("GRAI".to_string(), -1), ("LIVE".to_string(), -1)]
    );
}

/// Grain shipped away by `TRANSPORT` is gone before maintenance (`rules/sequenceofevents`), so the
/// ITEMS hover never says a unit holding none ate some.
#[test]
fn food_shipped_away_is_not_said_to_be_eaten() {
    let text = [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 1000 peasants (orcs), $0.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Eaters (900), Foo (1), consuming unit's food, 10 orcs [ORC], 5 grain [GRAI], \
         500 silver [SILV]. Weight: 125. Capacity: 0/0/150/0.",
        "+ Waystation [1] : Caravanserai.",
        "  * Broker (901), Foo (1), leader [LEAD], 100 silver [SILV]. Weight: 10. \
         Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 1 (30).",
        "",
    ]
    .join("\n");

    let row = preview_row(&text, "unit 900\nTRANSPORT 901 5 GRAI\n", "900");
    assert_eq!(holding(&row, "GRAI"), 0, "{:?}", row.item_changes);
    assert!(eaten(&row).is_empty(), "{:?}", row.item_changes);
}
