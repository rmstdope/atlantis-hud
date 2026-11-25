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
/// `rules/tableitemweights` only drowns a flier that ends its movement over water.
#[test]
fn a_flier_across_a_lake_is_not_warned_about() {
    let flier = lake_in_a_line_with(
        "* Wings (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 15/0/15/0.",
    );
    assert!(water_diagnostics(&flier, "unit 900\nMOVE SE SE\n").is_empty());
}

/// `ah-lxq6w`. `rules/tableitemweights`: "flying units must end their movement on land or else
/// drown." A flier whose MOVE stops on the lake is warned, in the Plan move panel's own words for
/// the same refusal (`PlannerPanel.tsx`, `flightWouldEndOverOcean`).
#[test]
fn a_flier_ending_its_move_over_a_lake_is_warned_about() {
    let flier = lake_in_a_line_with(
        "* Wings (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 15/0/15/0.",
    );
    let found = water_diagnostics(&flier, "unit 900\nMOVE SE\n");

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        "A single MOVE order would leave this unit over the lake at (2,2) when the month ran \
         out, and a unit that ends a turn over water drowns."
    );
    assert_eq!(found[0].line_start, Some(2));
    assert_eq!(found[0].severity, OrderDiagnosticSeverity::Warning);
}

/// `ah-lxq6w`, the case the month walk exists for. `rules/movement_normal`: "flying units have
/// four" movement points, so five hexes of ocean cannot be crossed in one month. The route does
/// reach land, but its first month runs out over the fourth ocean hex, and that is where the flier
/// drowns (`rules/tableitemweights`).
#[test]
fn a_flier_whose_month_runs_out_over_the_ocean_is_warned_about() {
    let sea = 5;
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : ocean (2,2) in Atlantis Ocean.\n\n");
    text.push_str("* Wings (900), Foo (1), 1 orcs [ORC]. Weight: 10. Capacity: 15/0/15/0.\n\n");
    for index in 0..sea {
        let (x, y) = (2 + index, 2 + index);
        let behind = if index == 0 { "plain" } else { "ocean" };
        let ahead = if index == sea - 1 { "plain" } else { "ocean" };
        text.push_str(&format!(
            "ocean ({x},{y}) in Atlantis Ocean.\n\nExits:\n  \
             Northwest : {behind} ({},{}) in Nowhere.\n  \
             Southeast : {ahead} ({},{}) in Nowhere.\n\n",
            x - 1,
            y - 1,
            x + 1,
            y + 1
        ));
    }
    let (fx, fy) = (2 + sea, 2 + sea);
    text.push_str(&format!(
        "plain ({fx},{fy}) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Northwest : ocean ({},{}) in Atlantis Ocean.\n",
        fx - 1,
        fy - 1
    ));

    let found = water_diagnostics(&text, "unit 900\nMOVE SE SE SE\nMOVE SE SE SE\n");

    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].message,
        "A single MOVE order would leave this unit over the sea at (5,5) when the month ran \
         out, and a unit that ends a turn over water drowns."
    );
    assert_eq!(
        found[0].line_start,
        Some(3),
        "the second MOVE holds the fourth step"
    );
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
