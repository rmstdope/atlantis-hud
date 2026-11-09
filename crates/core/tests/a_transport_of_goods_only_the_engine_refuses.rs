//! `ah-c2jte`. Two items are refused by the game though `rules/economy_transport` names no kind
//! they belong to: livestock [LIVE] (`data/LIVE`: a trade resource and food) and the amulet of
//! invulnerability [XXXX] (`data/XXXX`, made by no `create ...` spell). The engine flags both
//! `ItemType::NOTRANSPORT` (`../Atlantis gamedata.cpp`) and `ParseTransportableItem`
//! (`../Atlantis items.cpp`) matches no such item, so the order is refused as it is read.
//!
//! The navigator met it in Trident: `TRANSPORT 6062 ALL LIVE EXCEPT 8` reviewed clean and the game
//! refused it. Grain, the other food on the same page, is shipped.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::effects::preview_orders_for_remembered_report;
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::{classify_units, parse_report_full};

/// Broker (5531), a quartermaster owning a Caravanserai, holds both goods and some grain; one hex
/// away Quartermaster (6857) owns another, so target and reach are fine and only the item refuses.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  Southeast : mountain (2,2) in Nowhere.",
        "",
        "+ Waystation [1] : Caravanserai.",
        "  * Broker (5531), Foo (1), leader [LEAD], 20 livestock [LIVE], amulet of \
         invulnerability [XXXX], 10 grain [GRAI], 50000 silver [SILV]. Weight: 15. \
         Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 3 (180).",
        "",
        "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.",
        "",
        "Exits:",
        "  Northwest : plain (1,1) in Nowhere.",
        "",
        "+ Trade Post [1] : Caravanserai.",
        "  * Quartermaster (6857), Foo (1), leader [LEAD], 1000 silver [SILV]. Weight: 10. \
         Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 5 (450).",
        "",
    ]
    .join("\n")
}

fn worlds() -> [(&'static str, &'static str); 3] {
    [
        ("New Origins", atlantis_hud_fixtures::RULESET_JSON),
        (
            "Arcanum",
            atlantis_hud_fixtures::NEWAGE_ARCANUM_RULESET_JSON,
        ),
        (
            "Trident",
            atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        ),
    ]
}

fn findings_on_the_line(ruleset_json: &str, orders: &str) -> Vec<Finding> {
    let ruleset = Ruleset::from_json(ruleset_json).expect("the committed ruleset loads");
    let mut parsed = parse_report_full(&report());
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.line == Some(2))
        .collect()
}

fn broker_after(ruleset_json: &str, orders: &str, tag: &str) -> Option<i64> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset_json,
        &report(),
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    let broker = response
        .regions
        .iter()
        .filter(|region| region.region_id == "1:1,1")
        .flat_map(|region| &region.units)
        .find(|row| row.unit.unit_id == "5531")
        .expect("the sender's row is previewed");
    broker
        .unit
        .items
        .iter()
        .find(|item| item.tag == tag)
        .map(|item| item.amount)
}

#[test]
fn the_order_the_navigator_wrote_warns_and_leaves_the_livestock_with_the_sender() {
    for (world, rules) in worlds() {
        for word in ["TRANSPORT", "DISTRIBUTE"] {
            let orders = format!("unit 5531\n{word} 6857 ALL LIVE EXCEPT 8\n");

            let found = findings_on_the_line(rules, &orders);
            assert_eq!(found.len(), 1, "{world} {word}: {found:?}");
            assert_eq!(found[0].code.as_str(), "transport-item-refused");
            assert_eq!(found[0].unit_id.as_deref(), Some("5531"), "{world} {word}");
            assert_eq!(
                found[0].message, "The game will not transport LIVE, so they stay with this unit.",
                "{world} {word}"
            );
            assert_eq!(
                broker_after(rules, &orders, "LIVE"),
                Some(20),
                "{world} {word}: the livestock stays with the sender"
            );
        }
    }
}

#[test]
fn an_amulet_of_invulnerability_warns_and_stays_with_the_sender() {
    for (world, rules) in worlds() {
        for word in ["TRANSPORT", "DISTRIBUTE"] {
            let orders = format!("unit 5531\n{word} 6857 1 XXXX\n");

            let found = findings_on_the_line(rules, &orders);
            assert_eq!(found.len(), 1, "{world} {word}: {found:?}");
            assert_eq!(
                found[0].message, "The game will not transport XXXX, so they stay with this unit.",
                "{world} {word}"
            );
            assert_eq!(
                broker_after(rules, &orders, "XXXX"),
                Some(1),
                "{world} {word}: the amulet stays with the sender"
            );
        }
    }
}

#[test]
fn grain_still_ships_with_no_warning() {
    for (world, rules) in worlds() {
        let orders = "unit 5531\nTRANSPORT 6857 4 GRAI\n";

        let found = findings_on_the_line(rules, orders);
        assert!(found.is_empty(), "{world}: {found:?}");
        assert_eq!(
            broker_after(rules, orders, "GRAI"),
            Some(6),
            "{world}: the grain leaves the sender"
        );
    }
}
