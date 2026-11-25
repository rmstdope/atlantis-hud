//! `ah-cwyyq`. A typed MOVE onto water is warned about, as the Plan move planner already refuses it.
//!
//! `rules/move`: "A move can fail because the unit runs out of movement points, because the unit
//! attempts to move into the ocean, or because the unit attempts to enter a structure, and is
//! rejected." New Origins' engine treats a lake as water for that too (`ah-qpud9`).
//!
//! In `neworigins-3.0.0-g5-f21-t39`, Unit (4333) is a walker on plain (37,41) in Blarnfashire, whose
//! Southeast exit is ocean (38,42) and whose Southwest exit is plain (36,42).

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::orders::request::{validate_orders_request, ValidateOrdersRequest};
use atlantis_hud_core::{OrderDiagnostic, OrderDiagnosticSeverity};

const CODE: &str = "move-into-water";

fn water_diagnostics(report: &str, orders: &str) -> Vec<OrderDiagnostic> {
    let request = ValidateOrdersRequest {
        raw_orders: orders.into(),
        ruleset_json: Some(atlantis_hud_fixtures::RULESET_JSON.into()),
        raw_report: Some(report.into()),
        remembered_json: Some("[]".into()),
        ..Default::default()
    };
    validate_orders_request(&mut ReportCache::new(), &request)
        .diagnostics
        .into_iter()
        .filter(|diagnostic| diagnostic.code == CODE)
        .collect()
}

fn t39(orders: &str) -> Vec<OrderDiagnostic> {
    water_diagnostics(atlantis_hud_fixtures::G5_F21_T39.text, orders)
}

/// plain (1,1) - lake (2,2) - plain (3,3), with a walker in the first.
fn lake_in_a_line() -> String {
    lake_in_a_line_with("* Boots (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 0/0/15/0.")
}

fn lake_in_a_line_with(unit: &str) -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : lake (2,2) in Nowhere.\n\n");
    text.push_str(unit);
    text.push_str("\n\n");
    text.push_str("lake (2,2) in Nowhere.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (1,1) in Nowhere.\n  \
         Southeast : plain (3,3) in Nowhere.\n\n",
    );
    text.push_str("plain (3,3) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : lake (2,2) in Nowhere.\n");
    text
}

#[test]
fn a_move_into_the_ocean_is_warned_about() {
    let found = t39("unit 4333\nMOVE SE\n");

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        "(38,42) is ocean, and this unit would need a ship to be there."
    );
    assert_eq!(found[0].line_start, Some(2));
    assert_eq!(found[0].severity, OrderDiagnosticSeverity::Warning);
}

#[test]
fn a_move_into_a_lake_is_warned_about() {
    let found = water_diagnostics(&lake_in_a_line(), "unit 900\nMOVE SE\n");

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        "(2,2) is a lake, and this unit would need a ship to be there."
    );
}

#[test]
fn a_move_across_a_lake_names_the_lake_in_the_way() {
    let found = water_diagnostics(&lake_in_a_line(), "unit 900\nMOVE SE\nMOVE SE\n");

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        "The lake at (2,2) is in the way, and crossing it needs a ship."
    );
    assert_eq!(
        found[0].line_start,
        Some(2),
        "the first MOVE holds the wet step"
    );
}

#[test]
fn a_walking_route_that_stays_on_land_is_not_warned_about() {
    assert!(t39("unit 4333\nMOVE SW\n").is_empty());
    assert!(t39("unit 4333\nMOVE NE\n").is_empty());
}

/// The positive control: a flier crossing the lake to land on the far plain is not warned about.
/// Only crossing: `rules/tableitemweights` drowns a flier that ends its movement over water, which
/// is not this warning's business.
#[test]
fn a_flier_across_a_lake_is_not_warned_about() {
    let flier = lake_in_a_line_with(
        "* Wings (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 15/0/15/0.",
    );
    assert!(water_diagnostics(&flier, "unit 900\nMOVE SE SE\n").is_empty());
}

/// ADVANCE walks the same route as MOVE (`rules/advance`), so the same step is refused.
#[test]
fn an_advance_into_the_ocean_is_warned_about() {
    let found = t39("unit 4333\nADVANCE SE\n");

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        "(38,42) is ocean, and this unit would need a ship to be there."
    );
}

/// Where each row of `unit_id` stands in the units table, with its status and the hex it departs
/// to.
fn rows_of(
    report: &str,
    orders: &str,
    unit_id: &str,
) -> Vec<(
    String,
    atlantis_hud_core::orders::effects::UnitPreviewStatus,
    Option<String>,
)> {
    atlantis_hud_core::orders::effects::preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        report,
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

/// `ah-71z6y`. The move the warning above calls refused fails (`rules/move`: "the unit will move
/// multiple times ... until one of the moves fails. A move can fail because ... the unit attempts
/// to move into the ocean"), so the units table keeps the walker on its plain rather than showing
/// it arriving in the sea.
#[test]
fn the_units_table_keeps_a_walker_moved_into_the_ocean_on_land() {
    let rows = rows_of(
        atlantis_hud_fixtures::G5_F21_T39.text,
        "unit 4333\nMOVE SE\n",
        "4333",
    );
    assert!(
        rows.iter().all(|(region, status, to)| region == "1:37,41"
            && *status == atlantis_hud_core::orders::effects::UnitPreviewStatus::Present
            && to.is_none()),
        "{rows:?}"
    );
}

/// The control: the same walker's step onto the plain to the southwest still leaves.
#[test]
fn the_units_table_still_moves_a_walker_onto_land() {
    let rows = rows_of(
        atlantis_hud_fixtures::G5_F21_T39.text,
        "unit 4333\nMOVE SW\n",
        "4333",
    );
    assert!(
        rows.iter().any(|(region, status, to)| region == "1:37,41"
            && *status == atlantis_hud_core::orders::effects::UnitPreviewStatus::Departing
            && to.as_deref() == Some("1:36,42")),
        "{rows:?}"
    );
}

/// A walker told across a lake stops on its own shore: the first step fails and the second is
/// never taken.
#[test]
fn the_units_table_keeps_a_walker_moved_across_a_lake_on_its_shore() {
    let rows = rows_of(&lake_in_a_line(), "unit 900\nMOVE SE SE\n", "900");
    assert!(
        rows.iter().all(|(region, status, to)| region == "1:1,1"
            && *status == atlantis_hud_core::orders::effects::UnitPreviewStatus::Present
            && to.is_none()),
        "{rows:?}"
    );
}

/// plain (1,1) - plain (2,2) - lake (3,3) - plain (4,4), with a walker in the first.
fn land_then_lake() -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Nowhere.\n\n");
    text.push_str("* Boots (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 0/0/15/0.\n\n");
    text.push_str("plain (2,2) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (1,1) in Nowhere.\n  \
         Southeast : lake (3,3) in Nowhere.\n\n",
    );
    text.push_str("lake (3,3) in Nowhere.\n\n");
    text.push_str(
        "Exits:\n  Northwest : plain (2,2) in Nowhere.\n  \
         Southeast : plain (4,4) in Nowhere.\n\n",
    );
    text.push_str("plain (4,4) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : lake (3,3) in Nowhere.\n");
    text
}

/// A walker that takes a land step before the water stops on the last land hex: the first move
/// succeeds and the second fails (`rules/move`).
#[test]
fn the_units_table_stops_a_walker_on_the_last_land_hex_before_the_water() {
    let rows = rows_of(&land_then_lake(), "unit 900\nMOVE SE SE SE\n", "900");
    assert!(
        rows.iter().any(|(region, status, to)| region == "1:1,1"
            && *status == atlantis_hud_core::orders::effects::UnitPreviewStatus::Departing
            && to.as_deref() == Some("1:2,2")),
        "{rows:?}"
    );
    assert!(
        rows.iter()
            .all(|(region, _, _)| region == "1:1,1" || region == "1:2,2"),
        "{rows:?}"
    );
}
