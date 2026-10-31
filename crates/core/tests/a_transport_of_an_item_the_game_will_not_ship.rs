//! `ah-3bprj`. A TRANSPORT or DISTRIBUTE of an item the game will not ship is told so at the order,
//! and the goods stay with the sender.
//!
//! `rules/economy_transport` (New Origins, and `newage trident rules/economy_transport` alike):
//! "Men (including Leaders), summoned creatures (including illusionary ones), ships, mounts, war
//! machines, and items created using artifact lore need to be carried/sailed from one location to
//! another by a unit." `data/CRTA`: an amulet of true seeing [AMTS] is made by `create amulet of
//! true seeing`, an artifact-lore spell. The engine refuses such an item as the order is read, before
//! it looks at the target at all (`../Atlantis parseorders.cpp`: `ParseTransportableItem` skips
//! every `NOTRANSPORT` item, "TRANSPORT: Invalid item." / "DISTRIBUTE: Invalid item ...").
//!
//! Before this bead the forecast already kept the amulet with the sender, but nothing in Problems
//! or on the line said why.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, UnitPreview};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::{classify_units, parse_report_full};

const CODE: &str = "transport-item-refused";

/// Broker (5531), a quartermaster owning a Caravanserai, holds an amulet and some fur; one hex
/// away Quartermaster (6857) owns another Caravanserai, so the target and the reach are both
/// fine and only the item can refuse the shipment.
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
        "  * Broker (5531), Foo (1), leader [LEAD], amulet of true seeing [AMTS], 5 fur [FUR], \
         1000 silver [SILV]. Weight: 15. Capacity: 0/0/15/0. \
         Skills: quartermaster [QUAM] 3 (180).",
        "* Porter (5533), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
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

fn worlds() -> [(&'static str, &'static str); 2] {
    [
        ("New Origins", atlantis_hud_fixtures::RULESET_JSON),
        (
            "Trident",
            atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON,
        ),
    ]
}

fn findings(ruleset_json: &str, orders: &str) -> Vec<Finding> {
    let ruleset = Ruleset::from_json(ruleset_json).expect("the committed ruleset loads");
    let mut parsed = parse_report_full(&report());
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code.as_str() == CODE)
        .collect()
}

fn broker_after(ruleset_json: &str, orders: &str) -> Option<i64> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        ruleset_json,
        &report(),
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    let broker: Option<&UnitPreview> = response
        .regions
        .iter()
        .filter(|region| region.region_id == "1:1,1")
        .flat_map(|region| &region.units)
        .find(|row| row.unit.unit_id == "5531");
    // A refused shipment is still news, so the sender's row is previewed (`TransportSent::refused`).
    let broker = broker.expect("the sender's row is previewed");
    broker
        .unit
        .items
        .iter()
        .find(|item| item.tag == "AMTS")
        .map(|item| item.amount)
}

#[test]
fn a_transport_of_an_amulet_of_true_seeing_warns_at_the_order() {
    for (world, rules) in worlds() {
        for word in ["TRANSPORT", "DISTRIBUTE"] {
            let orders = format!("unit 5531\n{word} 6857 1 AMTS\n");

            let found = findings(rules, &orders);
            assert_eq!(found.len(), 1, "{world} {word}: {found:?}");
            let finding = &found[0];
            assert_eq!(finding.unit_id.as_deref(), Some("5531"), "{world} {word}");
            assert_eq!(finding.line, Some(2), "{world} {word}");
            assert_eq!(
                finding.message, "The game will not transport AMTS, so they stay with this unit.",
                "{world} {word}"
            );
            assert_eq!(
                broker_after(rules, &orders),
                Some(1),
                "{world} {word}: the amulet stays with the sender"
            );
        }
    }
}

/// Every kind `rules/economy_transport` names, one tag each: a man, a summoned creature (`data/IMP`,
/// made by `summon imps`), a ship (`data/COG`), a mount, a war machine (`data/CATP`), and an
/// artifact (`data/RING`, made by `create ring of invisibility`). The warning does not ask the
/// sender to hold any of it: the engine refuses the line as it is read.
#[test]
fn every_kind_the_rules_forbid_shipping_warns_at_the_order() {
    for (world, rules) in worlds() {
        for (tag, amount) in [
            ("LEAD", "1"),
            ("IMP", "1"),
            ("COG", "1"),
            ("HORS", "2"),
            ("CATP", "1"),
            ("RING", "ALL"),
        ] {
            let orders = format!("unit 5531\nTRANSPORT 6857 {amount} {tag}\n");
            let messages: Vec<String> = findings(rules, &orders)
                .into_iter()
                .map(|finding| finding.message)
                .collect();
            assert_eq!(
                messages,
                vec![format!(
                    "The game will not transport {tag}, so they stay with this unit."
                )],
                "{world} {tag}"
            );
        }
    }
}

#[test]
fn goods_the_game_ships_are_not_warned_about() {
    for (world, rules) in worlds() {
        let found = findings(rules, "unit 5531\nTRANSPORT 6857 5 FUR\n");
        assert!(found.is_empty(), "{world}: {found:?}");
    }
}

/// A line that names such an item and also a unit that could not receive it keeps the target's
/// warning, which the hover shares (`ah-19f7`), and gains the item's. Porter (5533) is no
/// quartermaster, so the same line with fur is refused for its target alone.
#[test]
fn an_item_the_game_will_not_ship_is_warned_about_beside_a_refused_target() {
    let ruleset = Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON).expect("loads");
    let mut parsed = parse_report_full(&report());
    classify_units(&mut parsed, &ruleset);
    let codes_on_the_line = |orders: &str| -> Vec<String> {
        review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
            .findings
            .into_iter()
            .filter(|finding| finding.line == Some(2))
            .map(|finding| finding.code.to_string())
            .collect()
    };
    assert_eq!(
        codes_on_the_line("unit 5531\nTRANSPORT 5533 1 FUR\n"),
        vec!["transport-target-refused".to_string()],
        "the target alone refuses fur"
    );
    assert_eq!(
        codes_on_the_line("unit 5531\nTRANSPORT 5533 1 AMTS\n"),
        vec!["transport-target-refused".to_string(), CODE.to_string()]
    );
}
