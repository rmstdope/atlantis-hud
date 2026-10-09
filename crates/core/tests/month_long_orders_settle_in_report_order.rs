//! A BUILD and a manufacturing PRODUCE drawing on one sharer's wood are settled in report order,
//! in every world (`ah-e23d.1`).
//!
//! Both engines run them as one walk: `../Atlantis` and `../atlantis-newage` `monthorders.cpp`
//! `RunMonthOrders` calls `AddNewBuildings`, `RunBuildHelpers` and then `RunProduceOrders`, which
//! goes through each structure's units in report order and runs a unit's manufacturing PRODUCE
//! (`RunUnitProduce`, crediting its output at once) or its BUILD (`Run1BuildOrder`, reading its
//! materials through `GetSharedNum`) as it reaches that unit. Primary production
//! (`RunAProduction`) follows the walk. The rules pages describe separate phases instead
//! (`rules/sequenceofevents`, `newage trident rules/sequenceofevents`); the navigator chose the
//! engine's schedule for New Origins, Arcanum and Trident alike (2026-10-09).
//!
//! The assertion is on the supplying unit's `item_changes`, in order, because that list is what
//! `packages/shared/src/unitCellPopup.ts` turns into the phrases a player reads on the sharer's
//! Items popup.
//!
//! Figures from the game's own pages: `data/carpenter` - "CARP 1 ... may PRODUCE wagons [WAGO]
//! from wood [WOOD] at a rate of 1 per man-month"; `data/farming` - "FARM 3: ... may BUILD a Farm
//! from 10 wood" (the same in `newage trident data` and `newage arcanum data`).

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::report::orders::extract_orders_template;

const SHARER: &str = "* Woodpile (901), Foo (1), sharing, orc [ORC], 12 wood [WOOD]. \
     Weight: 130. Capacity: 0/0/15/0.";
const CARPENTER: &str = "Wainwrights (900), Foo (1), 5 orcs [ORC]. Weight: 50. \
     Capacity: 0/0/75/0. Skills: carpenter [CARP] 1 (30).";
const FARMER: &str = "Fieldhands (902), Foo (1), 10 orcs [ORC]. Weight: 100. \
     Capacity: 0/0/150/0. Skills: farming [FARM] 3 (180).";

/// The farmer at work on an unfinished Farm, and the carpenter in a finished Tower. The engine
/// walks the region's objects in order (`monthorders.cpp` `RunProduceOrders`), and the report
/// lists them in that order, so the two structures' places on the report are their places in the
/// walk.
fn farm_then_tower() -> String {
    format!(
        "{SHARER}\n\n+ Building [1] : Farm, needs 10.\n  * {FARMER}\n\n\
         + Building [2] : Tower.\n  * {CARPENTER}"
    )
}

fn carpenter_then_farm() -> String {
    format!("* {CARPENTER}\n{SHARER}\n\n+ Building [1] : Farm, needs 10.\n  * {FARMER}")
}

/// One hex holding a carpenter wanting five wood, a sharer of twelve, and a farmer who could lay
/// ten - so whoever is reached first is served in full and the other gets the rest.
fn report(units: &str) -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        units,
        "",
    ]
    .join("\n")
}

/// The sharer's wood movements, in the order the popup renders them.
fn wood_changes(ruleset_json: &str, units: &str, build: &str) -> Vec<(String, i64)> {
    let text = report(units);
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\nunit 900\nPRODUCE wagon\nunit 902\n{build}\n");
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset_json,
        &text,
        "[]",
        &orders,
    )
    .expect("the ruleset loads");

    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "901")
        .expect("the sharing unit is on the ITEMS surface")
        .item_changes
        .iter()
        .filter(|change| change.tag == "WOOD")
        .map(|change| (format!("{:?}", change.cause), change.delta))
        .collect()
}

const WORLDS: [(&str, &str); 3] = [
    ("New Origins", atlantis_hud_fixtures::RULESET_JSON),
    (
        "Arcanum",
        atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON,
    ),
    (
        "Trident",
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
    ),
];

fn builder_first() -> Vec<(String, i64)> {
    vec![
        ("BuildSpent".to_string(), -10),
        ("ProductionSpent".to_string(), -2),
    ]
}

fn manufacturer_first() -> Vec<(String, i64)> {
    vec![
        ("ProductionSpent".to_string(), -5),
        ("BuildSpent".to_string(), -7),
    ]
}

#[test]
fn a_builder_above_a_manufacturer_takes_the_shared_wood_first() {
    for (world, ruleset) in WORLDS {
        assert_eq!(
            wood_changes(ruleset, &farm_then_tower(), "BUILD"),
            builder_first(),
            "{world}: the farmer is reached first and lays its ten; the wagons get the two left"
        );
    }
}

#[test]
fn a_builder_below_a_manufacturer_gets_what_it_leaves() {
    for (world, ruleset) in WORLDS {
        assert_eq!(
            wood_changes(ruleset, &carpenter_then_farm(), "BUILD"),
            manufacturer_first(),
            "{world}: the carpenter is reached first and takes its five; the Farm gets seven"
        );
    }
}

/// `monthorders.cpp` `AddNewBuildings` appends each new structure to the region's objects and
/// moves its founder into it before the walk starts, so a founder is reached after every unit
/// already in the hex, however high it sat on the report.
#[test]
fn a_founder_is_reached_after_every_other_unit() {
    let founder_on_top = format!("* {FARMER}\n{SHARER}\n* {CARPENTER}");
    for (world, ruleset) in WORLDS {
        assert_eq!(
            wood_changes(ruleset, &founder_on_top, "BUILD Farm"),
            manufacturer_first(),
            "{world}: the Farm is founded in a new structure, walked last"
        );
    }
}
