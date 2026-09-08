//! The two readers of "which unit does this `FORM` block's order belong to" agree.
//!
//! `standing_agreement` pins where a unit *stands*; this pins whose order it is. Both questions are
//! answered by walking one orders document, and both used to be answered by readers carrying their
//! own copy of the `FORM`-block state machine - which drifted five times (ah-p1p, ah-l2i, ah-048,
//! ah-4hux, ah-iqlw). The stack itself now lives once in [`super::blocks`] (`ah-i33f`); this is the
//! net under that, run over the preview walker (`orders::effects`) and the movement tracer
//! (`movement::fleet::OrderedUnits`) together.

use crate::cache::ReportCache;
use crate::movement::fleet::OrderedUnits;
use crate::movement::graph::Direction;
use crate::movement::orders::MoveStep;
use crate::orders::effects::{preview_orders_for_remembered_report, UnitPreviewStatus};

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

/// A one-region report whose unit 900 stands in nothing.
fn report() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.",
        "",
    ]
    .join("\n")
}

/// Every `(unit id, status)` pair the preview returns for the document.
fn preview_rows(orders: &str) -> Vec<(String, UnitPreviewStatus)> {
    let response = preview_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        &report(),
        "[]",
        orders,
    )
    .expect("the ruleset loads");
    response
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .map(|unit| (unit.unit.unit_id.clone(), unit.status))
        .collect()
}

#[test]
fn a_formed_units_move_belongs_to_the_formed_unit_in_both_readers() {
    let orders = "unit 900\nFORM 1\nMOVE N\nEND\n";

    let rows = preview_rows(orders);
    assert_eq!(
        rows,
        vec![("new-1".to_string(), UnitPreviewStatus::Departing)],
        "the preview puts the MOVE on the formed unit and nothing on its parent"
    );

    let ordered = OrderedUnits::from_document(orders);
    assert_eq!(
        ordered.steps_for("new-1"),
        Some(&[MoveStep::Go(Direction::North)][..])
    );
    assert_eq!(ordered.steps_for("900"), None);
}

#[test]
fn an_order_after_a_form_block_belongs_to_the_block_it_is_in_again() {
    let orders = "unit 900\nFORM 1\nMOVE N\nEND\nMOVE S\n";

    let rows = preview_rows(orders);
    // A unit that leaves the hex is two rows: the departing half and the arriving one (`ah-agbm`),
    // so this asserts what is present rather than how many rows there are.
    assert!(
        rows.contains(&("900".to_string(), UnitPreviewStatus::Departing)),
        "the parent departs on its own MOVE: {rows:?}"
    );
    assert!(
        rows.contains(&("new-1".to_string(), UnitPreviewStatus::Departing)),
        "the formed unit departs on the MOVE inside its block: {rows:?}"
    );

    let ordered = OrderedUnits::from_document(orders);
    assert_eq!(
        ordered.steps_for("new-1"),
        Some(&[MoveStep::Go(Direction::North)][..])
    );
    assert_eq!(
        ordered.steps_for("900"),
        Some(&[MoveStep::Go(Direction::South)][..])
    );
}

#[test]
fn a_form_whose_alias_cannot_be_read_swallows_its_orders() {
    let orders = "unit 900\nFORM x\nMOVE N\nEND\n";

    assert_eq!(
        preview_rows(orders),
        Vec::new(),
        "the MOVE reaches neither the parent nor any formed unit"
    );

    let ordered = OrderedUnits::from_document(orders);
    assert_eq!(ordered.steps_for("900"), None);
    assert_eq!(ordered.steps_for("new-1"), None);
}
