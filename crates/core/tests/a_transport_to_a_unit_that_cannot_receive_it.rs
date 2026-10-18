//! `ah-kjjv`. A TRANSPORT to a unit that is not a quartermaster is refused by the game, and the
//! order says so.
//!
//! `rules/transport`: "The target of the transport unit must be a unit with the quartermaster skill
//! and must be the owner of a transport structure." The engine refuses one that is not with
//! "TRANSPORT: Target ... is not a quartermaster" (`../Atlantis` `runorders.cpp`,
//! `CheckTransportOrders`), and the goods stay with the sender.
//!
//! `mountain (36,4)` of the committed turn 42 holds Ivanhoe, son of Cedric (683) and Robin Hood
//! (1162), both ours; Robin Hood has no quartermaster skill and owns no structure. The unit preview
//! already kept the silver with Ivanhoe; the order itself carried no warning.

use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, Finding};
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;
use common::ruleset;

const CODE: &str = "transport-target-refused";

fn findings(orders: &str) -> Vec<Finding> {
    let ruleset = ruleset();
    let mut parsed = parse_report_full(atlantis_hud_fixtures::G3_F42_T42.text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
        .findings
        .into_iter()
        .filter(|finding| finding.code.as_str() == CODE)
        .collect()
}

#[test]
fn ivanhoes_transport_to_robin_hood_warns_at_the_order() {
    let found = findings("#atlantis 42 \"<password>\"\n\nunit 683\nTRANSPORT 1162 100 SILV\n");

    assert_eq!(found.len(), 1, "{found:?}");
    let finding = &found[0];
    assert_eq!(finding.unit_id.as_deref(), Some("683"));
    assert_eq!(finding.line, Some(4));
    assert_eq!(
        finding.message,
        "Unit 1162 is not a quartermaster, so 100 SILV stay with this unit."
    );
}

/// `ah-xbnu`. Rebecca (1163) studies the quartermaster skill but stands outside the Caravanserai
/// Trader (6857) owns, and no order this month moves her in or hands it over. `rules/transport`
/// asks the target for the skill *and* ownership of a transport structure, so a month of STUDY can
/// meet only the first: the refusal is certain, and the order is still warned about.
#[test]
fn a_transport_to_a_unit_that_only_studies_the_quartermaster_skill_still_warns() {
    let found = findings(
        "#atlantis 42 \"<password>\"\n\nunit 683\nTRANSPORT 1163 100 SILV\nunit 1163\nSTUDY QUAM\n",
    );

    assert_eq!(found.len(), 1, "{found:?}");
    let finding = &found[0];
    assert_eq!(finding.unit_id.as_deref(), Some("683"));
    assert_eq!(finding.line, Some(4));
    assert_eq!(
        finding.message,
        "Unit 1163 is not a quartermaster, so 100 SILV stay with this unit."
    );
}
