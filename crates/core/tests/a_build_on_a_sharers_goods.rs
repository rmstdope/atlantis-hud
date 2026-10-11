//! A BUILD that spends only a sharer's goods shows on both rows (`ah-8r58`).
//!
//! `newage trident rules/share`: a sharing unit "will automatically supply" resources to another
//! unit of its faction in the same region. `newage trident rules/sequenceofevents` runs GIVE and
//! movement before the month-long orders, so a sharer that is given wood and moves this month
//! lends it to a BUILD in the hex it arrives in. `newage trident data/farming`: a Farm is built
//! from 10 wood.
//!
//! The navigator met it in the Trident game: the wood vanished from the sharer, and the builder -
//! whose own items do not change - had no row at all, so its `built` spend, the one place that
//! names the wood, never reached the table.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, ItemChangeCause, OrdersPreviewResponse, UnitPreview,
};
use atlantis_hud_core::report::orders::extract_orders_template;

const BUILDER: &str = "902";
const SHARER: &str = "3526";

const FIELDHANDS: &str = "Fieldhands (902), Foo (1), 10 orcs [ORC]. Weight: 100. \
     Capacity: 0/0/150/0. Skills: farming [FARM] 3 (180).";

/// The builder at work on an unfinished Farm in plain (1,1), with `beside` standing outside it,
/// and `away` standing in plain (2,2) to the southeast.
fn report(beside: &str, away: &str) -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : plain (2,2) in Nowhere.",
        "",
        beside,
        "",
        "+ Building [1] : Farm, needs 10.",
        &format!("  * {FIELDHANDS}"),
        "",
        "plain (2,2) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Northwest : plain (1,1) in Nowhere.",
        "",
        away,
        "",
    ]
    .join("\n")
}

fn preview(text: &str, orders: &str) -> OrdersPreviewResponse {
    let template = extract_orders_template(text)
        .map(|template| template.text)
        .unwrap_or_default();
    let orders = format!("{template}\nunit {BUILDER}\nBUILD\n{orders}");
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        text,
        "[]",
        &orders,
    )
    .expect("the Trident ruleset loads")
}

/// Every row `unit_id` has, arriving and departing alike.
fn rows<'a>(response: &'a OrdersPreviewResponse, unit_id: &str) -> Vec<&'a UnitPreview> {
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.unit.unit_id == unit_id)
        .collect()
}

fn assert_both_rows(response: &OrdersPreviewResponse) {
    let builder = rows(response, BUILDER);
    let builder = builder
        .first()
        .expect("the builder spending a sharer's wood has a preview row");
    let materials: Vec<(i64, &str)> = builder
        .built
        .iter()
        .flat_map(|spend| spend.materials.iter())
        .map(|material| (material.amount, material.tag.as_str()))
        .collect();
    assert_eq!(
        materials,
        vec![(10, "WOOD")],
        "the builder's spend names the wood"
    );

    // A sharer that moves has a departing and an arriving row carrying the same changes
    // (`ah-agbm`), so each row is asked on its own.
    let sharer = rows(response, SHARER);
    assert!(!sharer.is_empty(), "the lending sharer has a preview row");
    for row in sharer {
        let lent: Vec<(i64, Option<&str>)> = row
            .item_changes
            .iter()
            .filter(|change| change.tag == "WOOD" && change.cause == ItemChangeCause::BuildSpent)
            .map(|change| {
                (
                    change.delta,
                    change.other.as_ref().map(|party| party.unit_id.as_str()),
                )
            })
            .collect();
        assert_eq!(
            lent,
            vec![(-10, Some(BUILDER))],
            "the sharer's {:?} row names the builder its wood went to",
            row.status
        );
    }
}

#[test]
fn a_sharer_already_beside_the_build_lends_it_its_wood() {
    let text = report(
        "* Soldier (3526), Foo (1), sharing, orc [ORC], 10 wood [WOOD]. Weight: 110. \
         Capacity: 0/0/15/0.",
        "* Lumbers (2874), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
    );
    assert_both_rows(&preview(&text, ""));
}

#[test]
fn a_sharer_given_wood_and_arriving_lends_it_to_the_build() {
    let text = report(
        "* Bystander (2875), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "* Lumbers (2874), Foo (1), orc [ORC], 10 wood [WOOD]. Weight: 110. \
         Capacity: 0/0/15/0.\n\
         * Soldier (3526), Foo (1), sharing, 20 orcs [ORC]. Weight: 200. Capacity: 0/0/300/0.",
    );
    assert_both_rows(&preview(
        &text,
        "unit 2874\nGIVE 3526 10 WOOD\nunit 3526\nMOVE NW\n",
    ));
}
