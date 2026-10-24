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

use crate::common;

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

/// Whether the overload check warns about `unit_id` for `orders` over `report`.
fn warned(report: &str, orders: &str, unit_id: &str) -> bool {
    review_turn(
        &parse_report_full(report),
        orders,
        Some(&common::ruleset()),
        CheckOptions::default(),
    )
    .findings
    .iter()
    .any(|finding| {
        finding.code.as_str() == "unit-overloaded" && finding.unit_id.as_deref() == Some(unit_id)
    })
}

fn rows_of(report: &str, orders: &str) -> Vec<(String, UnitPreviewStatus, Option<String>)> {
    preview_orders_for_remembered_report(
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

fn traced_in(report: &str, orders: &str) -> bool {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        report,
        "[]",
        "900",
        orders,
    )
    .expect("the trace runs")
    .path
    .is_some()
}

/// A walker printed overloaded (20 against 15) that gives six gems away steps off at 14, so the
/// check is silent. It also holds an item the ruleset cannot price, which leaves the preview's own
/// movement on the report's printed line: the refusal must not read that line, or shedding the
/// ballast - the ordinary fix for being overloaded - would show as staying.
#[test]
fn a_walker_that_sheds_its_ballast_still_leaves_beside_an_unpriceable_item() {
    let report = REPORT.replace(
        "* Walker (900), Foo (1), human [HUMN], 4 gem [GEM]. Weight: 14.",
        "* Walker (900), Foo (1), human [HUMN], 10 gem [GEM], widget [WDGT]. Weight: 20.",
    );
    let orders = "unit 900\nGIVE 901 6 GEM\nMOVE N\n";
    assert!(!warned(&report, orders, "900"));
    let rows = rows_of(&report, orders);
    assert!(
        rows.iter()
            .any(|(region, status, _)| region == "1:1,1" && *status == UnitPreviewStatus::Departing),
        "{rows:?}"
    );
    assert!(traced_in(&report, orders));
}

/// Two hexes of open sea and a hull the ruleset cannot price, with the walker and the giver both
/// aboard. The walker's own legs are overloaded once given the gems, but it SAILs: a fleet is
/// judged by what its hull carries (`rules/movement_sailing`), so its own load refuses nothing.
const AT_SEA: &str = "Foo (1) Report\n\n\
ocean (1,1) in Sea.\n\
------------------------------------------------------------\n\n\
Exits:\n\x20\x20North : ocean (1,0) in Sea.\n\n\
+ Ship [329] : Junkboat.\n\
\x20\x20* Walker (900), Foo (1), human [HUMN], 4 gem [GEM]. Weight: 14. Capacity: 0/0/15/0.\n\
\x20\x20* Giver (901), Foo (1), human [HUMN], 2 gem [GEM]. Weight: 12. Capacity: 0/0/15/0.\n\n\
ocean (1,0) in Sea.\n\
------------------------------------------------------------\n\n\
Exits:\n\x20\x20South : ocean (1,1) in Sea.\n\n";

#[test]
fn an_overloaded_walker_that_sails_is_not_refused_for_its_legs() {
    // No `!warned` here: `unit-overloaded` reads MOVE alone, so it could not fire for a SAIL.
    let orders = "unit 901\nGIVE 900 2 GEM\nunit 900\nSAIL N\n";
    let rows = rows_of(AT_SEA, orders);
    assert!(
        rows.iter()
            .any(|(region, status, _)| region == "1:1,1" && *status == UnitPreviewStatus::Departing),
        "{rows:?}"
    );
    assert!(traced_in(AT_SEA, orders));
}

/// The walker stands aboard a longship the ruleset can price and writes its own `MOVE`, so the
/// trace times it as sailing. A MOVE is still the unit's own legs (`rules/movement_normal`): the
/// check calls it overloaded, and the units list and the map keep it at home with the warning.
#[test]
fn an_overloaded_walker_aboard_a_priceable_fleet_stays_when_it_walks() {
    let report = REPORT.replace(
        "* Walker (900),",
        "+ Ship [329] : Longship; Load: 0/150; Sailors: 0/4; MaxSpeed: 4.\n\x20\x20* Walker (900),",
    );
    assert!(warned(&report, OVERLOADED, "900"));
    let rows = rows_of(&report, OVERLOADED);
    assert!(!rows.is_empty());
    assert!(
        rows.iter().all(|(region, status, to)| region == "1:1,1"
            && *status == UnitPreviewStatus::Present
            && to.is_none()),
        "{rows:?}"
    );
    assert!(!traced_in(&report, OVERLOADED));
}

/// The walker holds an item the ruleset cannot price, so its capacity cannot be rebuilt from its
/// items; the check then reads the printed `Capacity:` line, and so must the refusal. Given gems
/// past 15, it is warned about and stays.
#[test]
fn an_overloaded_walker_beside_an_unpriceable_item_stays() {
    let report = REPORT.replace(
        "* Walker (900), Foo (1), human [HUMN], 4 gem [GEM]. Weight: 14.",
        "* Walker (900), Foo (1), human [HUMN], 3 gem [GEM], widget [WDGT]. Weight: 14.",
    );
    assert!(warned(&report, OVERLOADED, "900"));
    let rows = rows_of(&report, OVERLOADED);
    assert!(!rows.is_empty());
    assert!(
        rows.iter().all(|(region, status, to)| region == "1:1,1"
            && *status == UnitPreviewStatus::Present
            && to.is_none()),
        "{rows:?}"
    );
    assert!(!traced_in(&report, OVERLOADED));
}

/// An order of the walker's whose effect on its items cannot be counted - it gives away all its
/// magic items and holds none - changes nothing about its load, and the check does not doubt it
/// for that: the walker given gems past 15 is still warned about, and still stays.
#[test]
fn an_uncounted_order_does_not_excuse_an_overloaded_walker() {
    let orders = "unit 901\nGIVE 900 2 GEM\nunit 900\nGIVE 901 ALL MAGIC\nMOVE N\n";
    assert!(warned(REPORT, orders, "900"));
    let rows = rows_of(REPORT, orders);
    assert!(!rows.is_empty());
    assert!(
        rows.iter().all(|(region, status, to)| region == "1:1,1"
            && *status == UnitPreviewStatus::Present
            && to.is_none()),
        "{rows:?}"
    );
    assert!(!traced_in(REPORT, orders));
}

/// A refused MOVE never runs, so its OUT step does not take the walker off the longship it stands
/// in either.
#[test]
fn a_refused_move_out_leaves_the_walker_aboard() {
    let report = REPORT.replace(
        "* Walker (900),",
        "+ Ship [329] : Longship; Load: 0/150; Sailors: 0/4; MaxSpeed: 4.\n\x20\x20* Walker (900),",
    );
    let orders = "unit 901\nGIVE 900 2 GEM\nunit 900\nMOVE OUT N\n";
    assert!(warned(&report, orders, "900"));
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        atlantis_hud_fixtures::RULESET_JSON,
        &report,
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    let walker = response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .find(|row| row.unit.unit_id == "900")
        .expect("the gift changes its items");
    assert_eq!(walker.status, UnitPreviewStatus::Present);
    assert_eq!(walker.unit.structure_id.as_deref(), Some("329"));
    assert!(
        !walker
            .changes
            .iter()
            .any(|change| change.field == "structureId"),
        "{:?}",
        walker.changes
    );
}
