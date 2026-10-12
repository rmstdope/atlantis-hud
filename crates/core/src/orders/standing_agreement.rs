//! The three readers of "where does this unit stand once its ENTER/LEAVE have run" agree.
//!
//! Written before those readers were consolidated (ah-f03z) and kept afterwards. It is the only
//! test that runs one orders block through all three inputs the question is asked over - parsed
//! intents (`orders::semantics`), the raw orders document (`movement::fleet::OrderedUnits`) and the
//! preview walker (`orders::effects`) - and asserts one answer. Five beads each corrected one
//! reader at a time; this is what makes the next divergence fail loudly instead of shipping.

use crate::cache::ReportCache;
use crate::movement::fleet::OrderedUnits;
use crate::orders::effects::preview_orders_for_remembered_report;
use crate::orders::intents::read_intents;
use crate::orders::semantics::{flags_after_orders, leave_refused_with, structure_after_intents};
use crate::report::parse_report_full;

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

/// The empty structures every fixture hex also has, so the blocks below have something to ENTER.
/// 77 is deliberately not among them: it is the structure the hex does not have (`ah-5maa`).
const ALSO_HERE: [&str; 3] = ["4", "5", "9"];

/// A one-region report whose unit 900 stands where `reported` says: in a structure, or in nothing.
/// The hex also has the empty structures of [`ALSO_HERE`].
fn report(reported: Option<&str>) -> String {
    let mut lines = vec![
        "Foo (1) Report".to_string(),
        String::new(),
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.".to_string(),
        String::new(),
    ];
    for structure_id in ALSO_HERE {
        if reported != Some(structure_id) {
            lines.push(format!("+ Building [{structure_id}] : Stockade."));
        }
    }
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

/// What `orders::semantics` makes of the block, over parsed intents and the hex's structures.
fn by_intents(reported: Option<&str>, report_text: &str, orders: &str) -> Option<String> {
    let parsed = parse_report_full(report_text);
    let structures = &parsed.regions[0].structures;
    let read = read_intents(orders, None);
    let intents = read
        .iter()
        .filter(|block| block.unit_id == "900")
        .flat_map(|block| block.intents.iter().cloned())
        .collect::<Vec<_>>();
    // The fixture hex is a plain, where nothing refuses a LEAVE.
    structure_after_intents(reported, &intents, structures, false).map(str::to_string)
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
    OrderedUnits::of_month(&parsed, orders, None)
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

    let intents = by_intents(reported, &report_text, &orders);
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

/// The engine's `Do1EnterOrder` refuses an ENTER of an object the region does not have ("ENTER:
/// Can't enter that.") and returns before `MoveUnit`, so the unit stays where it was - in the
/// structure it already stood in, LEAVE or no LEAVE (`ah-5maa`). This assertion previously
/// expected 77 and so encoded the defect.
#[test]
fn entering_a_structure_the_report_does_not_list_leaves_the_unit_where_it_stood() {
    assert_eq!(agreed(Some("4"), "ENTER 77\n"), some("4"));
    assert_eq!(agreed(None, "ENTER 77\n"), None);
    assert_eq!(agreed(Some("4"), "LEAVE\nENTER 77\n"), some("4"));
}

/// `ah-86vk` let the validator ignore trailing text on an otherwise valid line, and the preview
/// followed it through `consumed_arguments`. The map read the raw tokens and refused the order,
/// so one document put the unit ashore in the pane and left it aboard on the map.
#[test]
fn an_enter_with_trailing_text_still_enters() {
    assert_eq!(agreed(Some("4"), "ENTER 5 junk\n"), some("5"));
}

#[test]
fn a_leave_with_trailing_text_still_leaves() {
    assert_eq!(agreed(Some("4"), "LEAVE junk\n"), None);
}

/// An ocean hex with a Longship [4] holding unit 900 as `walker` describes it, for the LEAVE the
/// game refuses at sea (`ah-djst`).
fn sea_report(walker: &str) -> String {
    [
        "Foo (1) Report",
        "",
        "ocean (1,1) in Sea.",
        "",
        "+ Longship [4] : Longship; Load: 10/150; Sailors: 0/4; MaxSpeed: 4.",
        &format!("  * {walker}"),
        "",
    ]
    .join("\n")
}

/// [`agreed`] at sea: every reader is given the ruleset that says the hex is water, and the
/// semantics reader folds the block's flag orders exactly as its `Ordered` does.
#[track_caller]
fn agreed_at_sea(walker: &str, block: &str) -> Option<String> {
    let report_text = sea_report(walker);
    let orders = format!("unit 900\n{block}");
    let ruleset = crate::movement::rules::Ruleset::from_json(RULESET).expect("the ruleset loads");
    // Classified, as every production reader sees it: the swimming capacity is the ruleset's.
    let classified = ReportCache::new().classified(&report_text, RULESET);
    let region = &classified.regions[0];
    let unit = &region.units[0];

    let read = read_intents(&orders, Some(&ruleset));
    let block900 = read
        .iter()
        .find(|block| block.unit_id == "900")
        .expect("the block for 900");
    let flags = flags_after_orders(&unit.flags, &block900.flag_changes);
    let refused = leave_refused_with(
        ruleset.is_water(&region.terrain),
        &flags,
        unit.movement.as_ref(),
    );
    let intents =
        structure_after_intents(Some("4"), &block900.intents, &region.structures, refused)
            .map(str::to_string);
    let document = OrderedUnits::of_month(&classified, &orders, Some(&ruleset))
        .structure_of(unit)
        .map(str::to_string);
    let preview = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        &report_text,
        "[]",
        &orders,
    )
    .expect("the ruleset loads")
    .regions
    .iter()
    .flat_map(|region| region.units.iter())
    .find(|row| row.unit.unit_id == "900")
    .map_or_else(|| some("4"), |row| row.unit.structure_id.clone());

    assert_eq!(
        intents, document,
        "semantics and movement disagree about {block:?} at sea"
    );
    assert_eq!(
        intents, preview,
        "semantics and the preview walker disagree about {block:?} at sea"
    );
    intents
}

const SEA_WALKER: &str = "Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.";
const SEA_SWIMMER: &str =
    "Swimmer (900), Foo (1), merfolk [MERF]. Weight: 10. Capacity: 0/0/15/15.";

/// `rules/leave`: only a unit "capable of swimming or flying" may leave a boat at sea, and
/// `rules/nocross` - run before LEAVE, `rules/sequenceofevents` - keeps a swimmer aboard too,
/// whichever line it is written on.
#[test]
fn a_leave_at_sea_is_refused_alike_by_every_reader() {
    assert_eq!(agreed_at_sea(SEA_WALKER, "LEAVE\n"), some("4"));
    assert_eq!(agreed_at_sea(SEA_SWIMMER, "LEAVE\n"), None);
    assert_eq!(agreed_at_sea(SEA_SWIMMER, "LEAVE\nNOCROSS 1\n"), some("4"));
    assert_eq!(
        agreed_at_sea(SEA_SWIMMER, "NOCROSS 1\nLEAVE\nNOCROSS 0\n"),
        None
    );
}
