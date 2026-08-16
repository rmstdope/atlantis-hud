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
    // discards of items nobody holds - none of which may leak into the preview. Its one order
    // with a real effect is unit 15571's "MOVE SE SE", so the whole answer is that departure
    // and its arrival, and nothing else.
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
        2,
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
