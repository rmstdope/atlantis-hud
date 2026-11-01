//! `ah-41tqi`. A TRANSPORT or DISTRIBUTE of ALL of an item its sender holds none of, while sharing
//! faction-mates in the hex hold some, moves nothing - and is told so at the order, with the exact
//! order that would draw on the sharers.
//!
//! `rules/transport` gives the three forms (`[num]`, `ALL`, `ALL ... EXCEPT [amount]`); `rules/share`:
//! SHARE 1 "instructs the unit to share its possessions with any other unit of your faction that
//! needs them". The engine reads ALL as the sender's own stock alone (`../Atlantis runorders.cpp`,
//! `RunTransportOrders`: `amt = u->items.GetNum(t->item)`, less the EXCEPT and never below none),
//! while it cuts an exact amount to `u->GetSharedNum(t->item)`, which counts the sharers too, and
//! spends it with `ConsumeShared`. The forecast already moves nothing for such an ALL (`ah-iidht`);
//! before this bead neither Problems nor the line said why.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::rules::Ruleset;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, UnitPreview};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::{classify_units, parse_report_full};

const CODE: &str = "transport-all-left-to-sharers";

const SHARERS: &str = "* Armoury (5532), Foo (1), sharing, leader [LEAD], 20 pikes [PIKE], \
     500 silver [SILV]. Weight: 30. Capacity: 0/0/15/0.\n\
     * Armoury Two (5534), Foo (1), sharing, leader [LEAD], 15 pikes [PIKE], 700 silver [SILV]. \
     Weight: 25. Capacity: 0/0/15/0.";

/// Broker (5531), a quartermaster owning a Caravanserai, holds `broker_goods` beside `beside`; one
/// hex away Quartermaster (6857) owns another Caravanserai beside Hauler (6858); Porter (5533)
/// beside the broker and Hauler are no quartermasters at all.
fn report(broker_goods: &str, beside: &str) -> String {
    [
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Southeast : mountain (2,2) in Nowhere.".to_string(),
        String::new(),
        "+ Waystation [1] : Caravanserai.".to_string(),
        format!(
            "  * Broker (5531), Foo (1), leader [LEAD]{broker_goods}. Weight: 10. \
             Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 3 (180)."
        ),
        "* Porter (5533), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.".to_string(),
        beside.to_string(),
        String::new(),
        "mountain (2,2) in Nowhere, 5 dwarves (dwarves), $3.".to_string(),
        String::new(),
        "Exits:".to_string(),
        "  Northwest : plain (1,1) in Nowhere.".to_string(),
        String::new(),
        "+ Trade Post [1] : Caravanserai.".to_string(),
        "  * Quartermaster (6857), Foo (1), leader [LEAD], 1000 silver [SILV]. Weight: 10. \
         Capacity: 0/0/15/0. Skills: quartermaster [QUAM] 5 (450)."
            .to_string(),
        "* Hauler (6858), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.".to_string(),
        String::new(),
    ]
    .join("\n")
}

fn sharing_report() -> String {
    report("", SHARERS)
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

fn all_findings(ruleset_json: &str, text: &str, orders: &str) -> Vec<Finding> {
    let ruleset = Ruleset::from_json(ruleset_json).expect("the committed ruleset loads");
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default()).findings
}

fn findings(ruleset_json: &str, text: &str, orders: &str) -> Vec<Finding> {
    all_findings(ruleset_json, text, orders)
        .into_iter()
        .filter(|finding| finding.code.as_str() == CODE)
        .collect()
}

/// The one warning on the broker's line 2, in every world, for TRANSPORT and DISTRIBUTE alike.
fn warns(text: &str, line: &str, expected: &str) {
    for (world, rules) in worlds() {
        for word in ["TRANSPORT", "DISTRIBUTE"] {
            let orders = format!("unit 5531\n{word} {line}\n");
            let found = findings(rules, text, &orders);
            assert_eq!(found.len(), 1, "{world} {word} {line}: {found:?}");
            let finding = &found[0];
            assert_eq!(finding.unit_id.as_deref(), Some("5531"), "{world} {word}");
            assert_eq!(finding.line, Some(2), "{world} {word}");
            assert_eq!(
                finding.message,
                expected.replace("{word}", word),
                "{world} {word} {line}"
            );
        }
    }
}

fn silent(text: &str, line: &str) {
    for (world, rules) in worlds() {
        for word in ["TRANSPORT", "DISTRIBUTE"] {
            let orders = format!("unit 5531\n{word} {line}\n");
            let found = findings(rules, text, &orders);
            assert!(found.is_empty(), "{world} {word} {line}: {found:?}");
        }
    }
}

#[test]
fn all_of_an_item_only_the_sharers_hold_warns_with_the_exact_order() {
    warns(
        &sharing_report(),
        "6857 ALL PIKE",
        "This unit holds no PIKE, so this {word} moves nothing. `{word} 6857 35 PIKE` would draw on the 35 your sharing units hold.",
    );
}

#[test]
fn all_except_less_than_the_sharers_hold_suggests_what_is_left() {
    warns(
        &sharing_report(),
        "6857 ALL PIKE EXCEPT 10",
        "This unit holds no PIKE, so this {word} moves nothing. `{word} 6857 25 PIKE` would draw on the 35 your sharing units hold.",
    );
}

#[test]
fn all_except_at_least_what_the_sharers_hold_warns_without_a_suggestion() {
    for except in [35, 40] {
        warns(
            &sharing_report(),
            &format!("6857 ALL PIKE EXCEPT {except}"),
            "This unit holds no PIKE, so this {word} moves nothing.",
        );
    }
}

#[test]
fn all_silver_only_the_sharers_hold_warns() {
    warns(
        &sharing_report(),
        "6857 ALL SILV",
        "This unit holds no SILV, so this {word} moves nothing. `{word} 6857 1200 SILV` would draw on the 1200 your sharing units hold.",
    );
}

/// A line refused for another reason tells only that refusal: the new warning adds nothing until
/// the order can ship at all. Hauler (6858), a hex away, is no quartermaster and owns no
/// Caravanserai, so Porter's TRANSPORT to it is refused in every world (`rules/transport`: "The
/// target of the transport unit must be a unit with the quartermaster skill and must be the owner
/// of a transport structure"); in New Origins so is the broker's TRANSPORT to Porter. (A New Age
/// Caravanserai owner's TRANSPORT reaches any unit, `ah-4kcg`.)
#[test]
fn a_refused_line_shows_only_its_refusal() {
    let refused = |rules: &str, orders: &str, world: &str| {
        let found = all_findings(rules, &sharing_report(), orders);
        assert!(
            found
                .iter()
                .any(|finding| finding.code.as_str() == "transport-target-refused"),
            "{world} {orders}: {found:?}"
        );
        assert!(
            found.iter().all(|finding| finding.code.as_str() != CODE),
            "{world} {orders}: {found:?}"
        );
    };
    for (world, rules) in worlds() {
        refused(rules, "unit 5533\nTRANSPORT 6858 ALL PIKE\n", world);
    }
    refused(
        atlantis_hud_fixtures::RULESET_JSON,
        "unit 5531\nTRANSPORT 5533 ALL PIKE\n",
        "New Origins",
    );
}

#[test]
fn no_warning_when_the_sender_holds_any() {
    silent(&report(", pike [PIKE], 1 silver [SILV]", SHARERS), "6857 ALL PIKE");
    silent(&report(", pike [PIKE], 1 silver [SILV]", SHARERS), "6857 ALL SILV");
}

#[test]
fn no_warning_when_no_sharer_holds_any() {
    // The faction-mates hold pikes but do not share them.
    silent(&report("", &SHARERS.replace("sharing, ", "")), "6857 ALL PIKE");
    // They share, but hold none.
    silent(
        &report(
            "",
            "* Armoury (5532), Foo (1), sharing, leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
        ),
        "6857 ALL PIKE",
    );
}

#[test]
fn an_exact_amount_is_not_warned() {
    silent(&sharing_report(), "6857 35 PIKE");
}

/// The forecast is unchanged by this bead: ALL still ships the sender's own alone, so the target
/// receives no pikes and the sharers keep theirs (`ah-iidht`).
#[test]
fn the_forecast_still_moves_nothing() {
    for (world, rules) in worlds() {
        let response = preview_orders_for_remembered_report(
            &mut ReportCache::new(),
            rules,
            &sharing_report(),
            "[]",
            "unit 5531\nTRANSPORT 6857 ALL PIKE\n",
        )
        .expect("the ruleset loads");
        let pikes = |unit: &str| -> Option<i64> {
            let row: Option<&UnitPreview> = response
                .regions
                .iter()
                .flat_map(|region| &region.units)
                .find(|row| row.unit.unit_id == unit);
            row.and_then(|row| row.unit.items.iter().find(|item| item.tag == "PIKE"))
                .map(|item| item.amount)
        };
        assert_eq!(pikes("6857"), None, "{world}: the target receives none");
        for sharer in ["5532", "5534"] {
            assert!(
                matches!(pikes(sharer), None | Some(20) | Some(15)),
                "{world}: sharer {sharer} keeps its pikes"
            );
        }
    }
}
