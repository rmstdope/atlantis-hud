//! The three readers of "where does this unit stand once its ENTER/LEAVE have run" agree.
//!
//! Written before those readers were consolidated (ah-f03z) and kept afterwards. It is the only
//! test that runs one orders block through all three inputs the question is asked over - parsed
//! intents (`orders::semantics`), the raw orders document (`movement::fleet::OrderedUnits`) and the
//! preview walker (`orders::effects`) - and asserts one answer. Five beads each corrected one
//! reader at a time; this is what makes the next divergence fail loudly instead of shipping.

use crate::movement::fleet::OrderedUnits;
use crate::orders::effects::preview_orders_for_remembered_report;
use crate::orders::intents::read_intents;
use crate::orders::semantics::structure_after_intents;
use crate::cache::ReportCache;
use crate::report::parse_report_full;

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

/// A one-region report whose unit 900 stands where `reported` says: in a structure, or in nothing.
fn report(reported: Option<&str>) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        String::new(),
    ];
    if let Some(structure_id) = reported {
        lines.push(format!("+ Building [{structure_id}] : Stockade."));
        lines.push(
            "  * Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.".to_string(),
        );
    } else {
        lines.push(
            "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.".to_string(),
        );
    }
    lines.push(String::new());
    lines.join("\n")
}

/// What `orders::semantics` makes of the block, over parsed intents.
fn by_intents(reported: Option<&str>, orders: &str) -> Option<String> {
    let read = read_intents(orders);
    let intents = read
        .iter()
        .filter(|block| block.unit_id == "900")
        .flat_map(|block| block.intents.iter().cloned())
        .collect::<Vec<_>>();
    structure_after_intents(reported, &intents).map(str::to_string)
}

/// What `movement::fleet` makes of it, over the raw document and the report's unit.
fn by_document(report_text: &str, orders: &str) -> Option<String> {
    let parsed = parse_report_full(report_text);
    let unit = parsed
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit_id == "900")
        .expect("unit 900 is in the report");
    OrderedUnits::from_document(orders)
        .structure_of(unit)
        .map(str::to_string)
}

/// What the preview walker makes of it. A unit the orders changed nothing about is left out of the
/// response entirely, and then the report's own answer stands.
fn by_preview(reported: Option<&str>, report_text: &str, orders: &str) -> Option<String> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        report_text,
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "900")
        .map_or_else(
            || reported.map(str::to_string),
            |unit| unit.unit.structure_id.clone(),
        )
}

/// Runs one block through all three readers and returns the answer they agree on, failing if they
/// do not.
#[track_caller]
fn agreed(reported: Option<&str>, block: &str) -> Option<String> {
    let report_text = report(reported);
    let orders = format!("unit 900\n{block}");

    let intents = by_intents(reported, &orders);
    let document = by_document(&report_text, &orders);
    let preview = by_preview(reported, &report_text, &orders);

    assert_eq!(
        intents, document,
        "semantics and movement disagree about {block:?} from {reported:?}"
    );
    assert_eq!(
        intents, preview,
        "semantics and the preview walker disagree about {block:?} from {reported:?}"
    );
    intents
}

fn some(id: &str) -> Option<String> {
    Some(id.to_string())
}

#[test]
fn enter_then_leave_ends_inside() {
    assert_eq!(agreed(None, "ENTER 5\nLEAVE\n"), some("5"));
}

#[test]
fn leave_then_enter_ends_inside() {
    assert_eq!(agreed(None, "LEAVE\nENTER 5\n"), some("5"));
}

#[test]
fn leave_alone_ends_in_nothing() {
    assert_eq!(agreed(Some("4"), "LEAVE\n"), None);
}

#[test]
fn the_last_enter_wins() {
    assert_eq!(agreed(None, "ENTER 4\nENTER 5\n"), some("5"));
}

#[test]
fn leave_enter_leave_ends_inside_the_one_entered() {
    assert_eq!(agreed(Some("9"), "LEAVE\nENTER 4\nLEAVE\n"), some("4"));
}

#[test]
fn an_enter_that_did_not_parse_is_not_an_enter() {
    // `ENTER` with anything but one number is an order the game does not have, so the LEAVE that
    // follows it is the only boarding order in the block.
    assert_eq!(agreed(Some("4"), "ENTER hall\nLEAVE\n"), None);
}

#[test]
fn no_boarding_orders_leaves_the_reports_answer() {
    assert_eq!(agreed(Some("4"), "BEHIND 1\n"), some("4"));
    assert_eq!(agreed(None, "BEHIND 1\n"), None);
}

#[test]
fn entering_a_structure_the_report_does_not_list_is_still_where_it_stands() {
    assert_eq!(agreed(Some("4"), "ENTER 77\n"), some("77"));
}
