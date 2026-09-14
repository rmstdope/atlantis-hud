use super::support::{document, far, trace};
use crate::common::at;
use atlantis_hud_core::cache::ReportCache;
use atlantis_hud_core::movement::request::{
    trace_orders_for_remembered_report, MoveOrderTraceResponse,
};
use atlantis_hud_core::unit_ref::UnitRef;

const RULESET: &str = atlantis_hud_fixtures::RULESET_JSON;

/// A synthetic report whose own unit 900 stands inside a shaft with a stated SE exit out of the
/// hex, which is the audit's own reproduction of the defect.
fn report_with_a_shaft() -> String {
    let mut text = String::from("Foo (1) Report\n\n");
    text.push_str("plain (1,1) in Inland, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Inland.\n\n");
    text.push_str("+ Shaft [3] : Shaft, contains an inner location.\n");
    text.push_str(
        "  * Walker (900), Foo (1), sharing, man [MAN]. Weight: 10. \
         Capacity: 0/0/15/0. Skills: none.\n\n",
    );
    text.push_str("plain (2,2) in Inland, 10 peasants (orcs), $5.\n\n");
    text.push_str("Exits:\n  Northwest : plain (1,1) in Inland.\n");
    text
}

/// (1,1) names only Southeast, so its Northeast side, towards (2,0) inside what the report has
/// shown, is a wall. A unit stopped by it never reaches the shaft, so nothing is said about it.
#[test]
fn a_wall_before_a_passage_follows_no_passage() {
    let path = trace_in_shaft("900", "MOVE NE IN SE")
        .path
        .expect("a traced path");

    assert!(
        path.passage.is_none(),
        "the walled unit never enters the shaft"
    );
    assert!(path.wall.is_some());
    assert!(path.steps.is_empty());
}

/// Traces one unit's orders over the shaft report.
fn trace_in_shaft(unit_id: &str, orders: &str) -> MoveOrderTraceResponse {
    trace_orders_for_remembered_report(
        &mut ReportCache::new(),
        RULESET,
        &report_with_a_shaft(),
        "[]",
        unit_id,
        &document(unit_id, orders),
    )
    .expect("the ruleset loads")
}

/// The defect itself. `rules/move`, direction 4: `IN` moves through an inner passage to another
/// region, and no report anywhere says which one - so the route stops at the structure's hex rather
/// than drawing the SE after it from the hex the unit never leaves.
///
/// A nexus gate needs no test of its own: a Gateway is a structure like any other and reaches this
/// same code path, which is why a gate holds without an exception being written for it.
#[test]
fn a_passage_ends_the_route_and_nothing_after_it_is_placed() {
    let path = trace_in_shaft("900", "MOVE IN SE")
        .path
        .expect("a traced path");

    assert_eq!(path.from, at(1, 1));
    assert!(path.steps.is_empty(), "nothing is drawn past the passage");

    let passage = path.passage.expect("the passage the route stopped at");
    assert_eq!(passage.coordinate, at(1, 1));
    assert_eq!(passage.structure, "Shaft [3]");
    assert_eq!(passage.steps_after, 1);
}

/// State 6: entering a structure by its number, and leaving one, are free and invisible as they
/// always were - only an `IN` stops a route.
#[test]
fn a_move_into_a_structure_by_its_number_is_still_free_and_invisible() {
    for orders in ["MOVE 3 SE", "MOVE OUT SE"] {
        let path = trace_in_shaft("900", orders).path.expect("a traced path");

        assert_eq!(path.steps.len(), 1, "{orders} still draws its SE");
        assert_eq!(path.steps[0].to, at(2, 2), "{orders}");
        assert_eq!(path.passage, None, "{orders} runs into no passage");
    }
}

/// `Shaft [3]` in `plain (1,1)` comes out in a mountain hex two levels down, as the screen's own
/// memory would hand it over.
fn known_shaft() -> String {
    r#"[{"entry":{"x":1,"y":1,"z":1},"structureId":"3","structure":"Shaft [3]",
        "destination":{"x":5,"y":5,"z":3},"destinationTerrain":"mountain","learnedInTurn":40}]"#
        .to_string()
}

/// Traces one unit's orders over the shaft report, told what the faction has learned.
fn trace_in_shaft_knowing(
    passages_json: &str,
    unit_id: &str,
    orders: &str,
) -> MoveOrderTraceResponse {
    atlantis_hud_core::movement::request::trace_orders_on_map(
        &mut ReportCache::new(),
        &atlantis_hud_core::movement::request::TraceMoveOrdersRequest {
            ruleset_json: RULESET.into(),
            raw_report: report_with_a_shaft(),
            remembered_json: "[]".into(),
            unit: UnitRef {
                // Walker (900) stands in plain (1,1).
                region_id: "1:1,1".into(),
                unit_id: unit_id.into(),
                arriving_from: None,
            },
            orders_document: document(unit_id, orders),
            map_json: String::new(),
            passages_json: passages_json.into(),
        },
    )
    .expect("the ruleset loads")
}

/// State 3: the journey carries on where the passage comes out.
#[test]
fn a_known_passage_carries_the_journey_on_where_it_comes_out() {
    let path = trace_in_shaft_knowing(&known_shaft(), "900", "MOVE IN SE")
        .path
        .expect("a traced path");

    assert!(path.steps.is_empty(), "nothing is drawn before the passage");
    let passage = path.passage.expect("the passage the route followed");
    assert_eq!(passage.coordinate, at(1, 1));
    assert_eq!(passage.terrain, "plain", "the entry hex's own terrain");
    assert_eq!(passage.steps_after, 0, "the tail is drawn, not dropped");

    let exit = passage.exit.expect("the far side");
    assert_eq!(exit.coordinate, far());
    assert_eq!(exit.terrain, "mountain");
    assert_eq!(exit.steps.len(), 1, "the SE beyond is drawn from there");
    assert_eq!(exit.steps[0].to.z, 3, "on the destination's own level");
}

/// `rules/tableitemweights`: "the movement point cost is equal to the normal cost to enter the
/// destination region", and mountain costs two to enter for a walker.
#[test]
fn a_crossing_is_priced_at_the_cost_of_entering_the_destination() {
    // `rules/tableitemweights`: "the following terrain types take two movement points for riding
    // or walking units to enter: Forest, Mountain, Swamp, Jungle, and Tundra".
    let expected = 2;

    let path = trace_in_shaft_knowing(&known_shaft(), "900", "MOVE IN")
        .path
        .expect("a traced path");
    let exit = path.passage.expect("a passage").exit.expect("a far side");
    assert_eq!(exit.cost, expected);
}

/// State 8: timing and knowledge stack. A walker has two movement points a month and the crossing
/// into mountain spends both, so the step beyond it is next month's.
#[test]
fn the_month_split_runs_across_the_crossing() {
    let path = trace_in_shaft_knowing(&known_shaft(), "900", "MOVE IN SE")
        .path
        .expect("a traced path");

    assert_eq!(path.months.len(), 2, "the crossing fills the first month");
    assert_eq!(path.months[0].steps, 1, "the crossing itself");
    assert_eq!(path.months[1].steps, 1, "the step beyond is next month's");
}

/// State 4 one link along: the first passage is followed, and a second one in the tail is not.
#[test]
fn a_second_passage_in_the_tail_is_not_followed() {
    let path = trace_in_shaft_knowing(&known_shaft(), "900", "MOVE IN SE IN SE")
        .path
        .expect("a traced path");

    let passage = path.passage.expect("a passage");
    let exit = passage.exit.expect("a far side");
    assert_eq!(exit.steps.len(), 1, "the SE beyond, and no further");
    assert_eq!(
        passage.steps_after, 2,
        "the second IN and the SE after it could not be placed"
    );
}

/// A map told nothing answers exactly what `ah-3u7c.1` pins.
#[test]
fn an_unknown_passage_is_untouched() {
    for passages in ["", "[]"] {
        let path = trace_in_shaft_knowing(passages, "900", "MOVE IN SE")
            .path
            .expect("a traced path");
        let passage = path.passage.expect("a passage");
        assert_eq!(passage.exit, None, "{passages}");
        assert_eq!(passage.steps_after, 1, "{passages}");
        assert!(path.steps.is_empty(), "{passages}");
    }
}

/// The wire contract for the far side: the screen reads `passage.exit.coordinate` and
/// `passage.terrain`.
#[test]
fn the_serde_shape_of_a_followed_passage() {
    let answer = trace_in_shaft_knowing(&known_shaft(), "900", "MOVE IN SE");
    let json = serde_json::to_value(&answer).expect("serializes");

    let passage = &json["path"]["passage"];
    assert_eq!(passage["terrain"], "plain");
    let exit = &passage["exit"];
    assert_eq!(exit["terrain"], "mountain");
    assert_eq!(exit["cost"], 2);
    assert_eq!(exit["coordinate"]["z"], 3);
    assert!(exit["steps"].is_array());

    let unknown =
        serde_json::to_value(trace_in_shaft_knowing("", "900", "MOVE IN SE")).expect("serializes");
    assert!(
        unknown["path"]["passage"]["exit"].is_null(),
        "no proof, null"
    );
}

/// The wire contract for the new field: TypeScript reads `passage.stepsAfter`, the way it reads
/// `blockedFrom`.
#[test]
fn the_serde_shape_of_a_passage() {
    let answer = trace_in_shaft("900", "MOVE IN SE");
    let json = serde_json::to_value(&answer).expect("serializes");

    let passage = &json["path"]["passage"];
    assert_eq!(passage["structure"], "Shaft [3]");
    assert_eq!(passage["stepsAfter"], 1, "camelCase, not steps_after");
    assert!(passage["coordinate"]["x"].is_number());

    let plain = serde_json::to_value(trace("18642", "MOVE N")).expect("serializes");
    assert!(plain["path"]["passage"].is_null(), "no passage, null");
}
