//! A BUILD or PRODUCE that spends only a sharer's goods shows on both rows (`ah-8r58`).
//!
//! `newage trident rules/share`: a sharing unit "will automatically supply" resources to another
//! unit of its faction in the same region, naming production. The rules page does not name BUILD;
//! that a BUILD draws on sharers too is the engine's (`monthorders.cpp` `Run1BuildOrder`, reading
//! its materials through `Unit::GetSharedNum` and spending them through `Unit::ConsumeShared`).
//! `newage trident rules/sequenceofevents` runs GIVE and movement before the month-long orders,
//! so a sharer that is given wood and moves this month lends it in the hex it arrives in.
//! `newage trident data/farming`: a Farm is built from 10 wood; `newage trident data/carpenter`:
//! wagons are produced from wood at 1 per man-month.
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
const PRODUCER: &str = "900";
const SHARER: &str = "3526";

const WAINWRIGHTS: &str = "* Wainwrights (900), Foo (1), 5 orcs [ORC]. Weight: 50. \
     Capacity: 0/0/75/0. Skills: carpenter [CARP] 1 (30).";

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
    let orders = format!("{template}\n{orders}");
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
    assert_both_rows(&preview(&text, "unit 902\nBUILD\n"));
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
        "unit 902\nBUILD\nunit 2874\nGIVE 3526 10 WOOD\nunit 3526\nMOVE NW\n",
    ));
}

/// The producer has a row with its wagons, and every row of the sharer names it as the unit its
/// five wood went to.
fn assert_production_rows(response: &OrdersPreviewResponse) {
    let producer = rows(response, PRODUCER);
    let producer = producer
        .first()
        .expect("the producer working a sharer's wood has a preview row");
    let made: Vec<(i64, &str)> = producer
        .produced
        .iter()
        .map(|item| (item.amount, item.tag.as_str()))
        .collect();
    assert_eq!(made, vec![(5, "WAGO")], "five carpenters make five wagons");

    let sharer = rows(response, SHARER);
    assert!(!sharer.is_empty(), "the lending sharer has a preview row");
    for row in sharer {
        let lent: Vec<(i64, Option<&str>)> = row
            .item_changes
            .iter()
            .filter(|change| {
                change.tag == "WOOD" && change.cause == ItemChangeCause::ProductionSpent
            })
            .map(|change| {
                (
                    change.delta,
                    change.other.as_ref().map(|party| party.unit_id.as_str()),
                )
            })
            .collect();
        assert_eq!(
            lent,
            vec![(-5, Some(PRODUCER))],
            "the sharer's {:?} row names the producer its wood went to",
            row.status
        );
    }
}

#[test]
fn a_sharer_already_beside_a_producer_lends_it_its_wood() {
    let text = report(
        &format!(
            "{WAINWRIGHTS}\n* Soldier (3526), Foo (1), sharing, orc [ORC], 10 wood [WOOD]. \
             Weight: 110. Capacity: 0/0/15/0."
        ),
        "* Lumbers (2874), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
    );
    assert_production_rows(&preview(&text, "unit 900\nPRODUCE wagon\n"));
}

#[test]
fn a_sharer_given_wood_and_arriving_lends_it_to_a_producer() {
    let text = report(
        WAINWRIGHTS,
        "* Lumbers (2874), Foo (1), orc [ORC], 10 wood [WOOD]. Weight: 110. \
         Capacity: 0/0/15/0.\n\
         * Soldier (3526), Foo (1), sharing, 20 orcs [ORC]. Weight: 200. Capacity: 0/0/300/0.",
    );
    assert_production_rows(&preview(
        &text,
        "unit 900\nPRODUCE wagon\nunit 2874\nGIVE 3526 10 WOOD\nunit 3526\nMOVE NW\n",
    ));
}

/// `ah-dqvi`: the sharer given wood and lending it on arrival starts and ends the month with
/// none, so its ITEMS hover can only show the wood from its movements - both of them, in the
/// month's order, each naming the other unit.
#[test]
fn a_sharer_given_wood_and_lending_it_carries_both_movements() {
    let text = report(
        "* Bystander (2875), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "* Lumbers (2874), Foo (1), orc [ORC], 10 wood [WOOD]. Weight: 110. \
         Capacity: 0/0/15/0.\n\
         * Soldier (3526), Foo (1), sharing, 20 orcs [ORC]. Weight: 200. Capacity: 0/0/300/0.",
    );
    let response = preview(
        &text,
        "unit 902\nBUILD\nunit 2874\nGIVE 3526 10 WOOD\nunit 3526\nMOVE NW\n",
    );
    let sharer = rows(&response, SHARER);
    assert!(!sharer.is_empty(), "the lending sharer has a preview row");
    for row in sharer {
        let wood: Vec<(i64, ItemChangeCause, Option<&str>)> = row
            .item_changes
            .iter()
            .filter(|change| change.tag == "WOOD")
            .map(|change| {
                (
                    change.delta,
                    change.cause,
                    change.other.as_ref().map(|party| party.unit_id.as_str()),
                )
            })
            .collect();
        assert_eq!(
            wood,
            vec![
                (10, ItemChangeCause::WasGiven, Some("2874")),
                (-10, ItemChangeCause::BuildSpent, Some(BUILDER)),
            ],
            "the sharer's {:?} row shows the wood arriving and leaving",
            row.status
        );
    }
}

/// `ah-jm7c`: the wood `unit_id`'s own row moved this month, as (delta, the other unit named).
/// Every row of the unit is asked, since a moving unit has a departing and an arriving one.
fn own_wood(response: &OrdersPreviewResponse, unit_id: &str) -> Vec<Vec<(i64, Option<String>)>> {
    rows(response, unit_id)
        .into_iter()
        .map(|row| {
            row.item_changes
                .iter()
                .filter(|change| change.tag == "WOOD")
                .map(|change| {
                    (
                        change.delta,
                        change.other.as_ref().map(|party| party.unit_id.clone()),
                    )
                })
                .collect()
        })
        .collect()
}

/// `ah-jm7c`: the other side of `ah-dqvi`. A producer or builder holding none of the material
/// draws it from the sharer, and its own row says so - drawn from the sharer, then spent - so
/// its ITEMS hover can name what it used and whose it was. The two net to nothing, as its
/// holdings do.
fn assert_drawn_from_sharer(response: &OrdersPreviewResponse, unit_id: &str, amount: i64) {
    let rows = own_wood(response, unit_id);
    assert!(!rows.is_empty(), "unit {unit_id} has a preview row");
    for wood in rows {
        assert_eq!(
            wood,
            vec![(amount, Some(SHARER.to_owned())), (-amount, None)],
            "unit {unit_id}'s row draws the wood from the sharer and then spends it"
        );
    }
}

#[test]
fn a_producer_names_the_sharer_beside_it_whose_wood_it_used() {
    let text = report(
        &format!(
            "{WAINWRIGHTS}\n* Soldier (3526), Foo (1), sharing, orc [ORC], 10 wood [WOOD]. \
             Weight: 110. Capacity: 0/0/15/0."
        ),
        "* Lumbers (2874), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
    );
    assert_drawn_from_sharer(&preview(&text, "unit 900\nPRODUCE wagon\n"), PRODUCER, 5);
}

#[test]
fn a_producer_names_the_arriving_sharer_whose_wood_it_used() {
    let text = report(
        WAINWRIGHTS,
        "* Lumbers (2874), Foo (1), orc [ORC], 10 wood [WOOD]. Weight: 110. \
         Capacity: 0/0/15/0.\n\
         * Soldier (3526), Foo (1), sharing, 20 orcs [ORC]. Weight: 200. Capacity: 0/0/300/0.",
    );
    assert_drawn_from_sharer(
        &preview(
            &text,
            "unit 900\nPRODUCE wagon\nunit 2874\nGIVE 3526 10 WOOD\nunit 3526\nMOVE NW\n",
        ),
        PRODUCER,
        5,
    );
}

#[test]
fn a_builder_names_the_sharer_beside_it_whose_wood_it_used() {
    let text = report(
        "* Soldier (3526), Foo (1), sharing, orc [ORC], 10 wood [WOOD]. Weight: 110. \
         Capacity: 0/0/15/0.",
        "* Lumbers (2874), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
    );
    assert_drawn_from_sharer(&preview(&text, "unit 902\nBUILD\n"), BUILDER, 10);
}

#[test]
fn a_builder_names_the_arriving_sharer_whose_wood_it_used() {
    let text = report(
        "* Bystander (2875), Foo (1), orc [ORC]. Weight: 10. Capacity: 0/0/15/0.",
        "* Lumbers (2874), Foo (1), orc [ORC], 10 wood [WOOD]. Weight: 110. \
         Capacity: 0/0/15/0.\n\
         * Soldier (3526), Foo (1), sharing, 20 orcs [ORC]. Weight: 200. Capacity: 0/0/300/0.",
    );
    assert_drawn_from_sharer(
        &preview(
            &text,
            "unit 902\nBUILD\nunit 2874\nGIVE 3526 10 WOOD\nunit 3526\nMOVE NW\n",
        ),
        BUILDER,
        10,
    );
}

/// `ah-jm7c`, as the navigator met it: Trident, desert (41,35) of `newage-arcanum-f5-t84.rep`.
/// 4686 gives its iron to the sharer 4008, and the weaponsmith 4840, holding none, produces five
/// swords from it. The weaponsmith's own row names the iron and whose it was.
#[test]
fn the_weaponsmith_names_the_sharer_whose_iron_it_forged() {
    let text = atlantis_hud_fixtures::NEWAGE_ARCANUM_F5_T84.text;
    let response = preview(
        text,
        "unit 4686\nGIVE 4008 10 IRON\nunit 4840\nPRODUCE 5 SWOR\n",
    );
    let smith = rows(&response, "4840");
    assert!(!smith.is_empty(), "the weaponsmith has a preview row");
    for row in smith {
        let iron: Vec<(i64, ItemChangeCause, Option<&str>)> = row
            .item_changes
            .iter()
            .filter(|change| change.tag == "IRON")
            .map(|change| {
                (
                    change.delta,
                    change.cause,
                    change.other.as_ref().map(|party| party.unit_id.as_str()),
                )
            })
            .collect();
        assert_eq!(
            iron,
            vec![
                (10, ItemChangeCause::DrawnFromSharer, Some("4008")),
                (-10, ItemChangeCause::ProductionSpent, None),
            ],
            "the weaponsmith's row draws the iron from 4008 and uses it"
        );
    }
}
