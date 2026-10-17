//! A unit the order checks call overloaded stays where it is on every surface (`ah-586v`).
//!
//! `rules/movement_normal`: *"A unit can walk provided that the carrying capacity of its people,
//! horses and wagons is at least as great as the weight of all its other items ... Otherwise the
//! unit cannot issue a MOVE order."* The Problems panel said so (`unit-overloaded`, "so it will not
//! move") while the units list greyed the row as departing to `→ …` and the map drew the route
//! into the next hex. The navigator chose that the map draws no route at all for it.
//!
//! The walker is one human with four gems: `data/HUMN` weighs 10 and walks 5, so the report prints
//! `Weight: 14. Capacity: 0/0/15/0`; `data/GEM` weighs 1. Its neighbour gives it two more, and
//! `rules/sequenceofevents` runs GIVE before movement, so it steps off carrying 16 against 15.

use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::trace_orders_for_remembered_report;
use atlantis_hud_core::orders::effects::{preview_orders_for_remembered_report, UnitPreviewStatus};
use atlantis_hud_core::orders::semantics::{review_turn, CheckOptions};
use atlantis_hud_core::report::parse_report_full;

mod common;

const REPORT: &str = "Foo (1) Report\n\n\
mountain (1,1) in Shire, 100 peasants (humans), $500.\n\
------------------------------------------------------------\n\n\
Exits:\n\x20\x20North : mountain (1,0) in Shire.\n\n\
* Walker (900), Foo (1), human [HUMN], 4 gem [GEM]. Weight: 14. Capacity: 0/0/15/0.\n\
* Giver (901), Foo (1), human [HUMN], 2 gem [GEM]. Weight: 12. Capacity: 0/0/15/0.\n\n\
mountain (1,0) in Shire, 100 peasants (humans), $500.\n\
------------------------------------------------------------\n\n\
Exits:\n\x20\x20South : mountain (1,1) in Shire.\n\n";

const OVERLOADED: &str = "unit 901\nGIVE 900 2 GEM\nunit 900\nMOVE N\n";

/// The same walk with nothing given: 14 against 15, so it leaves.
const LIGHT: &str = "unit 900\nMOVE N\n";

fn walker_rows(orders: &str) -> Vec<(String, UnitPreviewStatus, Option<String>)> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        REPORT,
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    response
        .regions
        .iter()
        .flat_map(|region| {
            region
                .units
                .iter()
                .filter(|row| row.unit.unit_id == "900")
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

fn traced(orders: &str) -> bool {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        REPORT,
        "[]",
        "900",
        orders,
    )
    .expect("the trace runs")
    .path
    .is_some()
}

#[test]
fn the_panel_calls_the_walker_overloaded() {
    let review = review_turn(
        &parse_report_full(REPORT),
        OVERLOADED,
        Some(&common::ruleset()),
        CheckOptions::default(),
    );
    assert!(
        review
            .findings
            .iter()
            .any(|finding| finding.code.as_str() == "unit-overloaded"
                && finding.unit_id.as_deref() == Some("900")),
        "{:#?}",
        review.findings
    );
}

#[test]
fn the_units_list_keeps_the_overloaded_walker_at_home() {
    let rows = walker_rows(OVERLOADED);
    // The gift changes its items, so the preview carries a row for it.
    assert!(!rows.is_empty());
    for (region, status, departing_to) in &rows {
        assert_eq!(region, "1:1,1", "{rows:?}");
        assert_eq!(*status, UnitPreviewStatus::Present, "{rows:?}");
        assert_eq!(*departing_to, None, "{rows:?}");
    }
}

#[test]
fn the_map_draws_no_route_for_the_overloaded_walker() {
    assert!(!traced(OVERLOADED));
}

/// The control: the same order on a walker that can carry its load still leaves on both surfaces,
/// so the two tests above fail for the overload and not for a broken fixture.
#[test]
fn a_walker_within_its_capacity_still_leaves() {
    assert!(walker_rows(LIGHT)
        .iter()
        .any(|(region, status, to)| region == "1:1,1"
            && *status == UnitPreviewStatus::Departing
            && to.as_deref() == Some("1:1,0")));
    assert!(traced(LIGHT));
}
