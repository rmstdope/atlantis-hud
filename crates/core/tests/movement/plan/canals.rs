//! `newage/trident rules/economy_canals`: "When a Canal is present, ships may sail through the
//! region in any direction, bypassing the normal restriction that prevents sailing through an
//! isthmus. ... A Canal of cut stone slows ships passing through it: the through-pass costs two
//! movement points where ordinary sailing costs one. A Mystic Canal, engineered from rootstone, lets
//! ships pass at full speed."

use super::support::{beyond, longship, neck, neck_text, plan_ruleset, trident};
use crate::common::at;
use atlantis_hud_core::movement::graph::{Direction, MapKnowledge, RememberedRegion};
use atlantis_hud_core::movement::plan::{plan_route, RouteProblem};
use atlantis_hud_core::report::parse_report_full;

const STONE_CANAL: &str = "+ The Cut [3] : Canal.\n";

const MYSTIC_CANAL: &str = "+ The Cut [3] : Mystic Canal.\n";

#[test]
fn a_stone_canal_opens_the_neck_and_prices_the_pass_at_two() {
    let report = neck(Direction::Southeast, STONE_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(route.steps.len(), 2);
    assert_eq!(route.steps[0].to, at(2, 2));
    assert_eq!(route.steps[0].cost, 2, "the through-pass costs two");
    assert_eq!(route.steps[0].canal, Some("Canal".to_string()));
    assert_eq!(route.steps[1].cost, 1);
    assert_eq!(route.steps[1].canal, None);
    assert_eq!(route.total_cost, 3);
    assert_eq!(route.months.len(), 1);
    assert_eq!(route.order, "SAIL SE SE");
}

#[test]
fn a_mystic_canal_passes_at_full_speed() {
    let report = neck(Direction::Southeast, MYSTIC_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(
        route.steps[0].cost, 1,
        "a mystic canal passes at full speed"
    );
    assert_eq!(route.steps[0].canal, Some("Mystic Canal".to_string()));
    assert_eq!(route.total_cost, 2);
}

/// A canal cannot fall down or sail away, so one seen months ago still opens the neck. The current
/// report does not describe the plain at all - only its two neighbours name it - which is exactly
/// the case `structures_ever_seen` exists for.
#[test]
fn a_remembered_canal_still_opens_the_neck() {
    let plain = neck(Direction::Southeast, STONE_CANAL)
        .regions
        .iter()
        .find(|region| region.coordinate == at(2, 2))
        .expect("the corridor describes the plain")
        .clone();

    let mut text = String::from("Atlantis Report For:\nFoo (1)\nDecember, Year 6\n\n");
    text.push_str("ocean (1,1) in Sea.\n\n");
    text.push_str("Exits:\n  Southeast : plain (2,2) in Coast.\n\n");
    text.push_str(&longship());
    text.push_str("ocean (3,3) in Sea.\n\n");
    text.push_str("Exits:\n  Northwest : plain (2,2) in Coast.\n");
    let current = parse_report_full(&text);

    let map = MapKnowledge::from_remembered(
        &current,
        &[RememberedRegion {
            region: plain,
            last_seen_turn: 1,
        }],
    );
    let unit = current
        .units()
        .find(|unit| unit.unit_id == "900")
        .expect("the fleet is aboard");
    let route =
        plan_route(&map, &trident(), unit, at(3, 3)).expect("a remembered canal still counts");

    assert_eq!(route.steps[0].canal, Some("Canal".to_string()));
    assert_eq!(route.steps[0].cost, 2);
}

/// Entering is not passing through: a fleet that stops in the canal region pays the ordinary cost.
#[test]
fn a_fleet_that_stops_in_a_canal_region_pays_the_ordinary_cost() {
    let report = neck(Direction::Southeast, STONE_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(2, 2)).expect("the plain is coastal");

    assert_eq!(route.steps.len(), 1);
    assert_eq!(route.steps[0].cost, 1);
    assert_eq!(route.steps[0].canal, None);
}

/// Nor has a fleet passed through when it turns out by a side the rule already allows.
#[test]
fn a_fleet_that_turns_out_of_a_canal_region_pays_the_ordinary_cost() {
    let report = neck(Direction::North, STONE_CANAL);
    let route =
        plan_ruleset(&trident(), &report, "900", beyond(Direction::North)).expect("N is allowed");

    assert_eq!(route.steps[0].cost, 1);
    assert_eq!(route.steps[0].canal, None);
}

/// The premium is *moved* onto the step the player sees, never added: what the panel lists must
/// still add up to what the panel totals.
#[test]
fn the_displayed_step_costs_still_sum_to_the_total() {
    let report = neck(Direction::Southeast, STONE_CANAL);
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(
        route.steps.iter().map(|step| step.cost).sum::<u32>(),
        route.total_cost
    );
}

/// The months are split from the costs the game charges, so a two-point fleet stops *in* the canal
/// region rather than being refused the hex the game lets it reach. This is the test that fails if
/// the premium is charged on entry instead of on the pass.
#[test]
fn a_month_that_cannot_afford_the_stone_pass_ends_in_the_canal_region() {
    let report = parse_report_full(
        &neck_text(Direction::Southeast, STONE_CANAL).replace("MaxSpeed: 4", "MaxSpeed: 2"),
    );
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(
        route.months.len(),
        2,
        "two points buy the entry and no more"
    );
    assert_eq!(route.months[0].ends_at, at(2, 2));
}

#[test]
fn the_neck_refusal_serialises_the_names_the_typescript_expects() {
    let value = serde_json::to_value(RouteProblem::IsthmusNeedsCanal {
        coordinate: at(2, 2),
        terrain: "plain".to_string(),
    })
    .expect("the refusal serialises");
    let object = value.as_object().expect("a JSON object");

    assert_eq!(object["kind"], "isthmusNeedsCanal");
    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(keys, ["coordinate", "kind", "terrain"]);
}

/// A fleet would use the faster canal. The name breaks a tie so the answer never depends on the
/// order a report listed the two in.
#[test]
fn a_mystic_canal_and_a_stone_one_in_one_region_take_the_faster() {
    let report = neck(
        Direction::Southeast,
        "+ The Cut [3] : Canal.\n+ The Deep Cut [4] : Mystic Canal.\n",
    );
    let route = plan_ruleset(&trident(), &report, "900", at(3, 3)).expect("a canal opens the neck");

    assert_eq!(route.steps[0].cost, 1);
    assert_eq!(route.steps[0].canal, Some("Mystic Canal".to_string()));
}
