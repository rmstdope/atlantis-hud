use crate::common::at;
use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};
use atlantis_hud_core::unit_ref::UnitRef;

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

/// Three own hexes in one column, north to south, each with a unit of its own.
fn three_hexes_in_a_column() -> String {
    [
        "Foo (1) Report",
        "",
        "plain (1,1) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  South : plain (1,3) in Nowhere.",
        "",
        "* North (900), Foo (1), 2 leaders [LEAD]. Weight: 20. Capacity: 0/0/30/0.",
        "",
        "plain (1,3) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  North : plain (1,1) in Nowhere.",
        "  South : plain (1,5) in Nowhere.",
        "",
        "* Middle (901), Foo (1), 2 leaders [LEAD]. Weight: 20. Capacity: 0/0/30/0.",
        "",
        "plain (1,5) in Nowhere, 10 peasants (orcs), $5.",
        "",
        "Exits:",
        "  North : plain (1,3) in Nowhere.",
        "",
        "* South (902), Foo (1), 2 leaders [LEAD]. Weight: 20. Capacity: 0/0/30/0.",
        "",
    ]
    .join("\n")
}

/// Traces the unit `unit_id` standing in `region_id` over the three-hex column.
fn trace_in_column(region_id: &str, unit_id: &str, orders: &str) -> MoveOrderTraceResponse {
    atlantis_hud_core::movement::request::trace_orders_on_map(
        &mut ReportCache::new(),
        &atlantis_hud_core::movement::request::TraceMoveOrdersRequest {
            ruleset_json: RULESET.into(),
            raw_report: three_hexes_in_a_column(),
            remembered_json: "[]".into(),
            unit: UnitRef {
                region_id: region_id.into(),
                unit_id: unit_id.into(),
                arriving_from: None,
            },
            orders_document: orders.into(),
            map_json: String::new(),
            passages_json: String::new(),
        },
    )
    .expect("the ruleset loads")
}

/// Traces the row of `unit_id` listed in `listed_in` that arrives there from `arriving_from`.
fn trace_arrival_in_column(
    listed_in: &str,
    arriving_from: &str,
    unit_id: &str,
    orders: &str,
) -> MoveOrderTraceResponse {
    atlantis_hud_core::movement::request::trace_orders_on_map(
        &mut ReportCache::new(),
        &atlantis_hud_core::movement::request::TraceMoveOrdersRequest {
            ruleset_json: RULESET.into(),
            raw_report: three_hexes_in_a_column(),
            remembered_json: "[]".into(),
            unit: UnitRef {
                region_id: listed_in.into(),
                unit_id: unit_id.into(),
                arriving_from: Some(arriving_from.into()),
            },
            orders_document: orders.into(),
            map_json: String::new(),
            passages_json: String::new(),
        },
    )
    .expect("the ruleset loads")
}

/// Every hex forms a New 1; only the southern one moves, and it is written last.
const EACH_HEX_FORMS_NEW_1: &str = "unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n\
unit 901\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n\
unit 902\nFORM 1\nMOVE N N\nEND\nGIVE NEW 1 1 LEAD\n";

#[test]
fn the_moving_new_unit_is_traced_from_the_hex_it_was_formed_in() {
    let path = trace_in_column("1:1,5", "new-1", EACH_HEX_FORMS_NEW_1)
        .path
        .expect("the southern New 1 moves");
    assert_eq!(path.from, at(1, 5));
    assert_eq!(path.steps.len(), 2);
    assert_eq!(path.steps[0].to, at(1, 3));
    assert_eq!(path.steps[1].to, at(1, 1));
}

#[test]
fn a_new_unit_that_stays_put_never_borrows_a_same_numbered_units_route() {
    for region_id in ["1:1,1", "1:1,3"] {
        assert_eq!(
            trace_in_column(region_id, "new-1", EACH_HEX_FORMS_NEW_1).path,
            None,
            "the New 1 in {region_id} writes no MOVE"
        );
    }
}

#[test]
fn two_moving_same_numbered_new_units_each_draw_their_own_route() {
    let orders = "unit 900\nFORM 1\nMOVE S\nEND\nGIVE NEW 1 1 LEAD\n\
unit 902\nFORM 1\nMOVE N N\nEND\nGIVE NEW 1 1 LEAD\n";
    let north = trace_in_column("1:1,1", "new-1", orders)
        .path
        .expect("the northern New 1 moves");
    assert_eq!(north.from, at(1, 1));
    assert_eq!(north.steps.len(), 1);
    assert_eq!(north.steps[0].to, at(1, 3));
    let south = trace_in_column("1:1,5", "new-1", orders)
        .path
        .expect("the southern New 1 moves");
    assert_eq!(south.from, at(1, 5));
    assert_eq!(south.steps.len(), 2);
    assert_eq!(south.steps[1].to, at(1, 1));
}

#[test]
fn a_new_units_number_alone_still_traces_when_only_one_hex_forms_it() {
    let path = trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        &three_hexes_in_a_column(),
        "[]",
        "new-1",
        "unit 900\nFORM 1\nMOVE S\nEND\nGIVE NEW 1 1 LEAD\n",
    )
    .expect("the ruleset loads")
    .path
    .expect("the only New 1 moves");
    assert_eq!(path.from, at(1, 1));
}

const SOUTH_FORMS_NEW_1_AND_MOVES_NORTH: &str =
    "unit 902\nFORM 1\nMOVE N N\nEND\nGIVE NEW 1 1 LEAD\n";

/// A named hex answers from that hex alone: no fallback to the number (`ah-jxrw`).
#[test]
fn a_hex_that_forms_no_such_new_unit_traces_nothing() {
    assert_eq!(
        trace_in_column("1:1,1", "new-1", SOUTH_FORMS_NEW_1_AND_MOVES_NORTH).path,
        None
    );
}

/// The shell hands the trace the hex a row set out from, whichever row selects it (`ah-jxrw`).
#[test]
fn a_new_unit_is_traced_from_the_hex_it_was_formed_in_whatever_row_selects_it() {
    let path = trace_in_column("1:1,5", "new-1", SOUTH_FORMS_NEW_1_AND_MOVES_NORTH)
        .path
        .expect("the only New 1 moves");
    assert_eq!(path.from, at(1, 5));
    assert_eq!(path.steps.len(), 2);
    assert_eq!(path.steps[1].to, at(1, 1));
}

#[test]
fn a_new_unit_arriving_where_a_same_numbered_one_stays_is_traced_from_its_own_hex() {
    let orders = "unit 900\nFORM 1\nEND\nGIVE NEW 1 1 LEAD\n\
unit 902\nFORM 1\nMOVE N N\nEND\nGIVE NEW 1 1 LEAD\n";
    let path = trace_in_column("1:1,5", "new-1", orders)
        .path
        .expect("the southern New 1 moves");
    assert_eq!(path.from, at(1, 5));
    assert_eq!(path.steps.len(), 2);
    assert_eq!(path.steps[1].to, at(1, 1));
    assert_eq!(
        trace_in_column("1:1,1", "new-1", orders).path,
        None,
        "the northern New 1 writes no MOVE"
    );
}

/// The southern New 1's arrival row, listed where the northern hex forms its own (`ah-jxrw`).
#[test]
fn an_arrival_row_is_traced_from_the_hex_it_set_out_from() {
    let path = trace_arrival_in_column("1:1,1", "1:1,5", "new-1", EACH_HEX_FORMS_NEW_1)
        .path
        .expect("the southern New 1 moves");
    assert_eq!(path.from, at(1, 5));
    assert_eq!(path.steps.len(), 2);
    assert_eq!(path.steps[1].to, at(1, 1));
}
