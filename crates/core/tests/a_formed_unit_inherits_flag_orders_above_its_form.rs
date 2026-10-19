//! `ah-78rd`. A formed unit inherits the flag orders its former wrote above the `FORM`.
//!
//! The engine applies BEHIND, AVOID and REVEAL while it parses the orders
//! (`../Atlantis/parseorders.cpp` `Game::ProcessBehindOrder`, `Game::ProcessAvoidOrder`,
//! `Game::ProcessRevealOrder`), and `Game::ProcessFormOrder` copies its former's flags at the `FORM`
//! line (`temp->CopyFlags(former)`; `../Atlantis/unit.cpp` `Unit::CopyFlags` copies `flags` and
//! `reveal`). The navigator chose that reading over `rules/sequenceofevents`, which lists FORM
//! before the flag orders. A flag order written below the `FORM` block is therefore not inherited.
//!
//! Fighters (14722) of the committed turn 42 is "revealing faction, sharing" - neither behind nor
//! avoiding (`neworigins-3.0.0-g3-f42-t42.rep`, its orders template).

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{
    preview_orders_for_remembered_report, OrdersPreviewResponse,
};
use atlantis_hud_core::report::orders::extract_orders_template;

const FIGHTERS: &str = "14722";

/// The turn's own orders with `lines` written at the top of the Fighters' block.
fn orders(lines: &str) -> String {
    let template = extract_orders_template(atlantis_hud_fixtures::G3_F42_T42.text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template");
    let header = format!("\nunit {FIGHTERS}\n");
    assert_eq!(template.matches(&header).count(), 1, "{header:?} once");
    template.replace(&header, &format!("{header}{lines}"))
}

fn preview(orders: &str) -> OrdersPreviewResponse {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        atlantis_hud_fixtures::G3_F42_T42.text,
        "[]",
        orders,
    )
    .expect("the ruleset loads")
}

/// The flags the unit table shows for the Fighters' new unit.
fn formed_flags(lines: &str) -> Vec<String> {
    let response = preview(&orders(lines));
    let formed: Vec<_> = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.unit.unit_id == "new-1")
        .collect();
    assert_eq!(formed.len(), 1, "the Fighters form exactly one new 1");
    formed[0].unit.flags.clone()
}

#[test]
fn a_behind_written_above_the_form_is_inherited() {
    assert!(
        formed_flags("BEHIND 1\nFORM 1\nEND\n").contains(&"behind".to_string()),
        "the new unit is behind"
    );
}

#[test]
fn avoid_and_reveal_written_above_the_form_are_inherited() {
    let flags = formed_flags("AVOID 1\nREVEAL\nFORM 1\nEND\n");
    assert!(flags.contains(&"avoiding".to_string()), "{flags:?}");
    assert!(
        !flags.contains(&"revealing faction".to_string()),
        "the bare REVEAL cancelled the Fighters' revealing faction before the FORM: {flags:?}"
    );
}

#[test]
fn a_flag_order_written_below_the_form_block_is_not_inherited() {
    let flags = formed_flags("FORM 1\nEND\nBEHIND 1\nAVOID 1\nREVEAL\n");
    assert_eq!(
        flags,
        vec!["revealing faction", "sharing"],
        "the new unit keeps the Fighters' reported flags"
    );
}
