//! The orders preview against a real turn: the committed report and its own template.
//!
//! The template is the document the player actually starts from, so it is the regression bar for
//! **accept on doubt**: full of @claim, @study, @work and taxing, none of which this preview
//! models, it must preview as exactly the effects its real orders have and not one row more. The
//! synthetic cases live with the module; what belongs here is the proof that real input behaves.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, UnitPreviewStatus};
use atlantis_hud_core::report::orders::extract_orders_template;

const TURN_71: &str = atlantis_hud_fixtures::G7_F95_T71.text;
const G5_F21_T24: &str = atlantis_hud_fixtures::G5_F21_T24.text;
const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

#[test]
fn the_committed_template_previews_exactly_its_one_real_effect() {
    let template = extract_orders_template(TURN_71)
        .expect("the committed report carries an orders template")
        .text;

    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        TURN_71,
        "[]",
        &template,
    )
    .expect("the ruleset loads");

    // The template is 27 unit blocks of @claim, @study, @work, taxing and standing @give
    // discards of items nobody holds - none of which may leak into the preview. `GIVE 2396 ALL
    // MARM`/`GIVE 2396 ALL MSWO`, standing in four of those blocks, are the exception: 2396
    // (Wistful Soldiers) stands in the same ocean hex as these units, so the goods genuinely
    // leave even though the report cannot say who receives them (`ah-vcp8.2`'s `Unprojectable`).
    // The one order with any *other* effect is unit 15571's "MOVE SE SE", so the whole answer is
    // that departure, its arrival, and the four gifts that empty their givers.
    let rows: Vec<_> = response
        .regions
        .iter()
        .flat_map(|region| {
            region
                .units
                .iter()
                .map(move |unit| (region.region_id.as_str(), unit))
        })
        .collect();
    assert_eq!(
        rows.len(),
        6,
        "rows were: {:?}",
        rows.iter()
            .map(|(region, unit)| format!("{region}: {} {:?}", unit.unit.unit_id, unit.status))
            .collect::<Vec<_>>()
    );

    let (origin, departing) = rows
        .iter()
        .find(|(_, unit)| unit.status == UnitPreviewStatus::Departing)
        .expect("a departure");
    assert_eq!(*origin, "1:18,44");
    assert_eq!(departing.unit.unit_id, "15571");
    assert_eq!(departing.departing_to.as_deref(), Some("1:20,46"));
    assert_eq!(
        departing.changes,
        Vec::new(),
        "moving is not a field change"
    );

    let (destination, arriving) = rows
        .iter()
        .find(|(_, unit)| unit.status == UnitPreviewStatus::Arriving)
        .expect("an arrival");
    assert_eq!(*destination, "1:20,46");
    assert_eq!(arriving.unit.unit_id, "15571");
    assert_eq!(arriving.arriving_from.as_deref(), Some("1:18,44"));

    // The four units whose `GIVE 2396 ALL ...` empties them of the one item they hold that 2396
    // can be given: present (they moved nowhere), and the tag is gone from their item list.
    for (unit_id, tag) in [
        ("881", "MARM"),
        ("12878", "MSWO"),
        ("12879", "MSWO"),
        ("20", "MARM"),
    ] {
        let (_, given) = rows
            .iter()
            .find(|(_, unit)| unit.unit.unit_id == unit_id)
            .unwrap_or_else(|| panic!("unit {unit_id} should have a preview row"));
        assert_eq!(given.status, UnitPreviewStatus::Present);
        assert!(
            !given.unit.items.iter().any(|item| item.tag == tag),
            "unit {unit_id} should have given away every {tag}: {:?}",
            given.unit.items
        );
    }
}

#[test]
fn a_real_unit_renamed_guarded_and_marched_previews_in_both_hexes() {
    // "* Seven of Eight (18642)" stands in the mountain at (7,53); north lies (7,51).
    let orders = concat!(
        "#atlantis 95 \"password\"\n",
        "unit 18642\n",
        "NAME UNIT \"Nine of Eight\"\n",
        "GUARD 1\n",
        "MOVE N\n",
        "#end\n",
    );

    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        TURN_71,
        "[]",
        orders,
    )
    .expect("the ruleset loads");

    let origin = response
        .regions
        .iter()
        .find(|region| region.region_id == "1:7,53")
        .expect("the mountain the unit leaves");
    let departing = origin
        .units
        .iter()
        .find(|unit| unit.unit.unit_id == "18642")
        .expect("the unit that got the orders");
    assert_eq!(departing.status, UnitPreviewStatus::Departing);
    assert_eq!(departing.departing_to.as_deref(), Some("1:7,51"));
    assert_eq!(departing.unit.name, "Nine of Eight");
    assert!(departing.unit.on_guard);
    assert!(
        departing
            .changes
            .iter()
            .any(|change| change.field == "name" && change.original == "Seven of Eight"),
        "changes were: {:?}",
        departing.changes
    );

    let destination = response
        .regions
        .iter()
        .find(|region| region.region_id == "1:7,51")
        .expect("the mountain the unit walks into");
    let arriving = destination
        .units
        .iter()
        .find(|unit| unit.unit.unit_id == "18642")
        .expect("the arriving row");
    assert_eq!(arriving.status, UnitPreviewStatus::Arriving);
    assert_eq!(arriving.arriving_from.as_deref(), Some("1:7,53"));
    assert_eq!(arriving.unit.name, "Nine of Eight");
}

/// The units-in-hex preview and the tracer must answer "who is aboard" the same way: a unit that
/// writes ENTER for a departing fleet departs with it (ah-ssd).
///
/// The preview reaches that answer through `Working`, which applies ENTER and LEAVE to the unit
/// row itself before anything asks where it stands - so this test held before ah-ssd too, and it
/// is here to pin the agreement rather than to prove the change. Its control is the second half:
/// without the ENTER the same unit stays put, so the assertion is not vacuous.
#[test]
fn a_unit_that_boards_a_departing_fleet_is_previewed_as_departing() {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        G5_F21_T24,
        "[]",
        "unit 10575\nSAIL SE\nunit 1297\nENTER 235\n",
    )
    .expect("the ruleset loads");

    let boarding = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|unit| unit.unit.unit_id == "1297")
        .expect("the boarding unit has a preview row");
    assert_eq!(boarding.status, UnitPreviewStatus::Departing);
    assert_eq!(boarding.departing_to.as_deref(), Some("1:37,45"));

    let without = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        G5_F21_T24,
        "[]",
        "unit 10575\nSAIL SE\n",
    )
    .expect("the ruleset loads");
    assert!(
        without
            .regions
            .iter()
            .flat_map(|region| region.units.iter())
            .all(|unit| unit.unit.unit_id != "1297"),
        "with no ENTER, the unit ashore is not carried and has nothing to preview"
    );
}
