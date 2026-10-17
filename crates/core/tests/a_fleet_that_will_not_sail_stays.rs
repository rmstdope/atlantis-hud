//! A fleet the sailing checks say will not sail stays where it is on every surface (`ah-zbtx`).
//!
//! `rules/movement_sailing`: *"A fleet can only move if the total weight of everything aboard does
//! not exceed the fleet's capacity ... Also, there must be enough sailors aboard (using the SAIL
//! order), to sail the fleet, or it will not go anywhere."* The Problems panel said so
//! (`fleet-undercrewed`, `fleet-overloaded`: "so it will not sail") while the units list showed the
//! crew departing, the map drew the route, and the SILVER column had a unit lend upkeep in the hex
//! the fleet never reaches. A fleet refused for want of a course was already shown staying; this
//! is the same for the other two refusals, in the same two exploratory-testing fixtures.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::trace_orders_for_remembered_report;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, UnitPreviewStatus};
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions, TurnReview};
use atlantis_hud_core::orders::silver::SilverChangeCause;
use atlantis_hud_core::report::orders::extract_orders_template;
use atlantis_hud_core::report::{classify_units, parse_report_full};

mod common;

fn template(text: &str) -> String {
    extract_orders_template(text)
        .map(|template| template.text)
        .expect("the fixture carries an orders template")
}

/// `text`'s orders template with `from` replaced by `to`, exactly once.
fn edited(text: &str, from: &str, to: &str) -> String {
    let orders = template(text);
    assert_eq!(orders.matches(from).count(), 1, "{from:?} is unique");
    orders.replacen(from, to, 1)
}

fn review(text: &str, orders: &str) -> TurnReview {
    let ruleset = common::ruleset();
    let mut parsed = parse_report_full(text);
    classify_units(&mut parsed, &ruleset);
    review_turn(&parsed, orders, Some(&ruleset), CheckOptions::default())
}

fn warned(text: &str, orders: &str, code: &str) -> bool {
    review(text, orders)
        .findings
        .iter()
        .any(|finding| finding.code.as_str() == code)
}

/// Every preview row of `unit_id`: its region, status and where it is shown departing to.
fn rows(
    text: &str,
    orders: &str,
    unit_id: &str,
) -> Vec<(String, UnitPreviewStatus, Option<String>)> {
    preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        orders,
    )
    .expect("the ruleset loads")
    .regions
    .iter()
    .flat_map(|region| {
        region
            .units
            .iter()
            .filter(|row| row.unit.unit_id == unit_id)
            .map(|row| {
                (
                    region.region_id.clone(),
                    row.status,
                    row.departing_to.clone(),
                )
            })
    })
    .collect()
}

/// A unit the month leaves untouched gets no row at all, and is drawn as the report shows it; any
/// row it does get must keep it at `home`.
fn stays(text: &str, orders: &str, unit_id: &str, home: &str) {
    let rows = rows(text, orders, unit_id);
    for (region, status, departing_to) in &rows {
        assert_eq!(region, home, "{unit_id}: {rows:?}");
        assert_eq!(*status, UnitPreviewStatus::Present, "{unit_id}: {rows:?}");
        assert_eq!(*departing_to, None, "{unit_id}: {rows:?}");
    }
}

fn departs(text: &str, orders: &str, unit_id: &str) -> bool {
    rows(text, orders, unit_id)
        .iter()
        .any(|(_, status, to)| *status == UnitPreviewStatus::Departing && to.is_some())
}

fn traced(text: &str, orders: &str, unit_id: &str) -> bool {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        text,
        "[]",
        unit_id,
        orders,
    )
    .expect("the trace runs")
    .path
    .is_some()
}

// --- Too few sailors: Longship [329] at ocean (44,12), 4/4 sailors between 11125 and 12590. ---

const OCEAN: &str = "1:44,12";

fn short_of_sailors() -> String {
    edited(
        atlantis_hud_fixtures::G3_F42_T42.text,
        "[SAIL] 2 (90).\n@SAIL\n",
        "[SAIL] 2 (90).\nSTUDY COMB\n",
    )
}

#[test]
fn the_panel_calls_the_longship_short_of_sailors() {
    assert!(warned(
        atlantis_hud_fixtures::G3_F42_T42.text,
        &short_of_sailors(),
        "fleet-undercrewed"
    ));
}

#[test]
fn the_units_list_keeps_a_longship_short_of_sailors_at_sea() {
    let orders = short_of_sailors();
    for unit_id in ["11125", "12590"] {
        stays(
            atlantis_hud_fixtures::G3_F42_T42.text,
            &orders,
            unit_id,
            OCEAN,
        );
    }
}

#[test]
fn the_map_draws_no_route_for_a_longship_short_of_sailors() {
    let orders = short_of_sailors();
    for unit_id in ["11125", "12590"] {
        assert!(
            !traced(atlantis_hud_fixtures::G3_F42_T42.text, &orders, unit_id),
            "{unit_id}"
        );
    }
}

/// The control: with both sailors at the oars the longship still leaves on both surfaces, so the
/// tests above fail for the crew and not for a broken fixture.
#[test]
fn a_fully_crewed_longship_still_leaves() {
    let text = atlantis_hud_fixtures::G3_F42_T42.text;
    let orders = template(text);
    assert!(!warned(text, &orders, "fleet-undercrewed"));
    assert!(departs(text, &orders, "11125"));
    assert!(traced(text, &orders, "11125"));
}

// --- Overload: Raft [235] in Lonthax (36,44), Load 220/450, and Unit (8333) entering it. ---

const LONTHAX: &str = "1:36,44";

fn overloaded() -> String {
    edited(
        atlantis_hud_fixtures::G5_F21_T24.text,
        "quartermaster [QUAM] 3 (285).\n@study quam\n",
        "quartermaster [QUAM] 3 (285).\nENTER 235\n@study quam\n",
    )
}

#[test]
fn the_panel_calls_the_raft_overloaded() {
    assert!(warned(
        atlantis_hud_fixtures::G5_F21_T24.text,
        &overloaded(),
        "fleet-overloaded"
    ));
}

#[test]
fn the_units_list_keeps_an_overloaded_raft_in_lonthax() {
    let orders = overloaded();
    for unit_id in ["8333", "10575", "10594"] {
        stays(
            atlantis_hud_fixtures::G5_F21_T24.text,
            &orders,
            unit_id,
            LONTHAX,
        );
    }
}

#[test]
fn the_map_draws_no_route_for_an_overloaded_raft() {
    let orders = overloaded();
    for unit_id in ["8333", "10575"] {
        assert!(
            !traced(atlantis_hud_fixtures::G5_F21_T24.text, &orders, unit_id),
            "{unit_id}"
        );
    }
}

/// Who `unit_id` lends upkeep to, as the SILVER column's `lent for upkeep` lines name them.
fn lent_for_upkeep(
    silver: &[atlantis_hud_core::orders::silver::UnitSilver],
    unit_id: &str,
) -> Vec<String> {
    silver
        .iter()
        .find(|row| row.unit_id == unit_id)
        .unwrap_or_else(|| panic!("{unit_id} is forecast"))
        .changes
        .iter()
        .filter(|change| change.cause == SilverChangeCause::LentForUpkeep)
        .filter_map(|change| change.other.clone())
        .collect()
}

/// Maintenance is shared between units in the same region after movement
/// (`rules/economy_maintenance`, `rules/sequenceofevents`). Raft [218]'s Drones (9508) and (9579)
/// are at ocean (38,44), where an overloaded Raft [235] never arrives: 9508 does not feed the
/// raft's passenger Drones (10594), and the unit that boarded in Lonthax lends nothing to 9579.
#[test]
fn an_overloaded_raft_shares_upkeep_only_in_lonthax() {
    // Through the request the SILVER column reads, which measures where each unit ends the month.
    let silver = validate_orders_request(
        &mut ReportCache::new(),
        &ValidateOrdersRequest {
            raw_orders: overloaded(),
            ruleset_json: Some(atlantis_hud_fixtures::RULESET_JSON.to_string()),
            raw_report: Some(atlantis_hud_fixtures::G5_F21_T24.text.to_string()),
            disabled_codes: None,
            map_json: None,
            known_passages_json: None,
            remembered_json: Some("[]".to_string()),
        },
    )
    .silver;
    let resident = lent_for_upkeep(&silver, "9508");
    assert!(
        !resident.contains(&"Drones (10594)".to_string()),
        "{resident:?}"
    );
    let boarder = lent_for_upkeep(&silver, "8333");
    assert!(
        !boarder.contains(&"Drones (9579)".to_string()),
        "{boarder:?}"
    );
}

/// The control: the raft as the report leaves it, with nobody boarding, still sails.
#[test]
fn a_raft_within_its_capacity_still_leaves() {
    let text = atlantis_hud_fixtures::G5_F21_T24.text;
    let orders = template(text);
    assert!(!warned(text, &orders, "fleet-overloaded"));
    assert!(departs(text, &orders, "10575"));
    assert!(traced(text, &orders, "10575"));
}
