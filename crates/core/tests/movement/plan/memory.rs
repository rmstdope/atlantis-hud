use super::support::{f42_t40, remembered};
use crate::common::{at, ruleset};
use atlantis_hud_core::movement::graph::MapKnowledge;
use atlantis_hud_core::movement::plan::{plan_route, RouteProblem};
use atlantis_hud_core::movement::rules::MovementMode;
use atlantis_hud_core::report::model::Coordinate;
use atlantis_hud_core::report::{parse_report_full, ParsedReport};

const F42_T41: &str = atlantis_hud_fixtures::G3_F42_T41.text;
const F42_T42: &str = atlantis_hud_fixtures::G3_F42_T42.text;

fn f42_t41() -> ParsedReport {
    parse_report_full(F42_T41)
}

fn f42_t42() -> ParsedReport {
    parse_report_full(F42_T42)
}

/// Plans for one of the faction's own units, by id, against a caller-built map.
fn plan_with(
    map: &MapKnowledge,
    report: &ParsedReport,
    unit_id: &str,
    destination: Coordinate,
) -> Result<atlantis_hud_core::movement::plan::RoutePlan, RouteProblem> {
    let unit = report
        .units()
        .find(|unit| unit.unit_id == unit_id)
        .expect("the report should carry that unit");
    plan_route(map, &ruleset(), unit, destination)
}

/// `tundra (41,3) in Huykash` is a region t40 visited and neither t41 nor t42 describes; t42 knows
/// it only as an exit of `forest (40,2)`, so a named hex with no exits of its own. `tundra (42,2)`
/// is joined to the rest of the map only through it. From t42 alone there is no way there; with
/// t40 remembered, (41,3) brings its exits back and the route exists.
#[test]
fn a_remembered_turn_opens_a_route_the_current_report_cannot_find() {
    let t42 = f42_t42();

    let current_only = MapKnowledge::from_report(&t42);
    let problem = plan_with(&current_only, &t42, "10293", at(42, 2))
        .expect_err("t42 alone never heard of (42,2)'s exits");
    assert!(
        matches!(problem, RouteProblem::NoKnownRoute),
        "expected no known route, got {problem:?}"
    );

    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));
    let route = plan_with(&accumulated, &t42, "10293", at(42, 2))
        .expect("t40 remembered brings (41,3)'s exits back");

    assert_eq!(route.mode, MovementMode::Ride);
    assert_eq!(route.steps.len(), 2);
    assert!(route.steps.iter().all(|step| step.terrain == "tundra"));
    assert!(
        route.steps.iter().all(|step| !step.estimated),
        "both hexes are named by a report, not guessed"
    );
    assert_eq!(route.steps[0].cost, 2);
    assert_eq!(route.steps[1].cost, 2);
    assert_eq!(route.total_cost, 4);
    assert_eq!(route.months.len(), 1, "four points buy exactly one month");
}

/// The state the bead calls stale: a hex remembered from an earlier turn than the one on screen.
/// It exists only because a hex the current report merely names was once actually visited.
#[test]
fn a_remembered_hex_keeps_the_turn_it_was_last_seen_in() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));

    let stale = accumulated.hex(at(41, 3)).expect("remembered from t40");
    assert_eq!(stale.last_seen_turn, Some(40));
    assert!(stale.visited, "t40 actually stood in it");

    let current = accumulated.hex(at(40, 2)).expect("described by t42");
    assert_eq!(current.last_seen_turn, Some(42));

    let current_only = MapKnowledge::from_report(&t42);
    assert!(
        !current_only.hex(at(41, 3)).is_some_and(|hex| hex.visited),
        "t42 alone only names (41,3), it never stood there"
    );
}

/// "Lookout (12195)" takes the same two tundra steps as the woodsmen above, each costing 2, but
/// with a walker's two movement points a month rather than a rider's four: each step exactly fills
/// one month, so the route takes two months with nothing carried over.
#[test]
fn a_remembered_route_can_take_more_than_one_month() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));

    let route = plan_with(&accumulated, &t42, "12195", at(42, 2)).expect("a walker's route");

    assert_eq!(route.mode, MovementMode::Walk);
    assert_eq!(route.total_cost, 4);
    assert_eq!(route.months.len(), 2, "four points at two a month");
    assert_eq!(
        route.months[0].ends_at,
        at(41, 3),
        "the first month spends its two points on the first step"
    );
}

/// Three steps starting from `tundra (40,0)`, crossing both a hex the current turn describes and
/// one it only remembers: `Scout (1512)` walks south into `forest (40,2)` (described by t42),
/// southeast into `tundra (41,3)` (remembered from t40), then northeast into `tundra (42,2)`
/// (named by t42, reachable only because (41,3) brought its exits back).
#[test]
fn a_route_crosses_both_the_current_turn_and_a_remembered_one() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t40(), 40)]));

    let route =
        plan_with(&accumulated, &t42, "1512", at(42, 2)).expect("a three-step route across both");

    assert_eq!(route.steps.len(), 3);
    assert_eq!(
        route.total_cost, 6,
        "three tundra/forest steps at two apiece"
    );
    assert_eq!(route.months.len(), 3, "six points at two a month");
    assert_eq!(
        route.steps[1].to,
        at(41, 3),
        "the middle step is the remembered hex"
    );
    assert!(
        route.steps.iter().all(|step| !step.estimated),
        "every hex on the way is named by a report"
    );
}

/// Remembering t41 alone leaves no route: (41,3) appears only in t40. This pins that
/// `from_remembered` needs the specific turn that saw a hex, not merely "an earlier one".
#[test]
fn remembering_the_wrong_turn_still_finds_no_route() {
    let t42 = f42_t42();
    let accumulated = MapKnowledge::from_remembered(&t42, &remembered(&[(&f42_t41(), 41)]));

    let problem =
        plan_with(&accumulated, &t42, "10293", at(42, 2)).expect_err("t41 never saw (41,3) either");
    assert!(matches!(problem, RouteProblem::NoKnownRoute));
}
