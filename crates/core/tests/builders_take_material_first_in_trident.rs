//! What a Trident player actually reads on a supplying unit's Items popup (`ah-g9sf.5`).
//!
//! `newage trident rules/sequenceofevents` runs *"BUILD orders are processed: new structures are
//! laid down first, then the work of everyone building on them is counted"* and only then
//! *"PRODUCE orders are processed -- both those that make items out of other items ... and those
//! that take items from the region's own resources"*. New Origins splits the two PRODUCE phases
//! around BUILD instead, so the same hex reads the other way round there.
//!
//! The assertion is on the supplying unit's `item_changes`, in order, because that list is exactly
//! what `packages/shared/src/unitCellPopup.ts` turns into the two phrases a player reads - the
//! build debit first, then the smaller production one. No new wording ships with this bead; only
//! the figures and their order move.
//!
//! Figures from the game's own pages: `newage trident data/carpenter` - "CARP 1 ... may PRODUCE
//! wagons [WAGO] from wood [WOOD] at a rate of 1 per man-month"; `newage trident data/farming` -
//! "FARM 3: ... may BUILD a Farm from 10 wood".

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::report::orders::extract_orders_template;

/// One hex: a carpenter above a sharer of fifteen wood, and a farmer below it founding a Farm.
///
/// The carpenter sits **above** the builder on the report on purpose. Under New Origins it would
/// therefore take its five wood first; under Trident the builder settles a whole phase earlier and
/// takes its ten whatever its report position.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        "* Wainwrights (900), Foo (1), 5 orcs [ORC]. Weight: 50. Capacity: 0/0/75/0. \
         Skills: carpenter [CARP] 1 (30).",
        "* Woodpile (901), Foo (1), sharing, orc [ORC], 15 wood [WOOD]. Weight: 160. \
         Capacity: 0/0/15/0.",
        "* Fieldhands (902), Foo (1), 10 orcs [ORC]. Weight: 100. Capacity: 0/0/150/0. \
         Skills: farming [FARM] 3 (180).",
        "",
    ]
    .join("\n")
}

fn orders() -> String {
    let text = report();
    let template = extract_orders_template(&text)
        .map(|template| template.text)
        .unwrap_or_default();
    format!("{template}\nunit 900\nPRODUCE wagon\nunit 902\nBUILD Farm\n")
}

/// The supplying unit's wood movements, in the order the popup renders them.
fn wood_changes(ruleset_json: &str) -> Vec<(String, i64)> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset_json,
        &report(),
        "[]",
        &orders(),
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

#[test]
fn a_trident_builder_is_debited_before_the_producer_above_it() {
    assert_eq!(
        wood_changes(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON),
        vec![
            ("BuildSpent".to_string(), -10),
            ("ProductionSpent".to_string(), -5)
        ],
    );
}

#[test]
fn new_origins_still_debits_the_producer_first() {
    assert_eq!(
        wood_changes(atlantis_hud_fixtures::RULESET_JSON),
        vec![
            ("ProductionSpent".to_string(), -5),
            ("BuildSpent".to_string(), -10)
        ],
    );
}
