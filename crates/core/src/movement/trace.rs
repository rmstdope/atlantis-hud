//! Drawing the MOVE order a unit already has.
//!
//! The planner works forwards from a destination the player picks; this works forwards from the
//! order the player wrote, so the map can show where a unit is already going. The two answer
//! different questions, and this one must not refuse: an order into unexplored country or across
//! terrain the unit cannot cross is still the player's stated intent, and drawing it is the point.
//! Legality is the order validator's business, not this module's.
//!
//! Where the map runs out the trace carries on by arithmetic, guessing each hex's terrain from the
//! last one seen - biomes cluster, so the guess is usually right, and it is only a costing detail:
//! nothing invented is ever drawn as map knowledge.

use serde::{Deserialize, Serialize};

use crate::movement::graph::{geometric_neighbour, MapKnowledge};
use crate::movement::mode::{mobility, Mobility};
use crate::movement::orders::MoveStep;
use crate::movement::plan::{blocks, split_into_months, step_cost, MonthLeg, RouteStep};
use crate::movement::rules::{MovementMode, Ruleset};
use crate::report::model::ReportUnit;

/// Where an order takes a unit, hex by hex and month by month.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracedPath {
    pub from: crate::report::model::Coordinate,
    /// Every hex the order enters. Terrain is a guess wherever the map could not say, and roads
    /// are never guessed.
    pub steps: Vec<RouteStep>,
    /// Empty when [`mode`](Self::mode) is unknown - the timing cannot be split without knowing
    /// how fast the unit travels.
    pub months: Vec<MonthLeg>,
    /// How the unit travels, or nothing when it is overloaded or the report never said.
    pub mode: Option<MovementMode>,
    /// The index of the first step the game would refuse - a walker entering the sea - and
    /// nothing when the whole path is passable or no mode is known to rule with. Everything from
    /// this step onward is doubt rather than plan, whatever month it falls in.
    pub blocked_from: Option<usize>,
}

/// Walks a MOVE order from where the unit stands.
///
/// Returns nothing only when the map does not know the unit's own hex - with no origin there is
/// nowhere to draw from. Every other difficulty is absorbed: unknown country is extrapolated,
/// unknown terrain guessed, and a unit whose speed is unstated gets a path with no months.
#[must_use]
pub fn trace_move(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    unit: &ReportUnit,
    steps: &[MoveStep],
) -> Option<TracedPath> {
    let origin = map.hex_of_unit(unit)?;
    let from = origin.coordinate;
    let mode = match mobility(unit) {
        Mobility::Moves(mode) => Some(mode),
        Mobility::Overloaded | Mobility::Unstated => None,
    };

    let mut position = from;
    let mut terrain = origin.terrain.clone();
    let mut route = Vec::new();
    let mut blocked_from = None;

    for step in steps {
        let MoveStep::Go(direction) = step else {
            continue;
        };

        // A stated exit is the map's own word and survives the wrap seam; arithmetic is the
        // fallback for country nobody has described.
        let next = map
            .neighbours(position)
            .find(|(heading, _)| heading == direction)
            .map_or_else(
                || geometric_neighbour(position, *direction),
                |(_, neighbour)| neighbour,
            );
        let next_terrain = map
            .hex(next)
            .map_or_else(|| terrain.clone(), |hex| hex.terrain.clone());

        // Without a mode the costs would be invented twice over, so they are left at zero and the
        // empty months say the timing is unknowable. `step_cost` refuses both undescribed hexes
        // and terrain the unit may not cross; either way the trace costs the terrain at face
        // value instead, because the order is drawn as written, not as permitted.
        let (cost, road) = mode.map_or((0, false), |mode| {
            step_cost(map, ruleset, mode, position, *direction, next)
                .unwrap_or_else(|| (ruleset.terrain_cost(&next_terrain, mode), false))
        });

        // The first step the game would refuse marks everything after it as doubt. Judged by the
        // planner's own rule, so the two never disagree about what the sea stops.
        if blocked_from.is_none() && mode.is_some_and(|mode| blocks(ruleset, mode, &next_terrain)) {
            blocked_from = Some(route.len());
        }

        route.push(RouteStep {
            direction: *direction,
            to: next,
            terrain: next_terrain.clone(),
            cost,
            road,
        });
        position = next;
        terrain = next_terrain;
    }

    let months = mode.map_or_else(Vec::new, |mode| {
        split_into_months(ruleset, mode, from, &route)
    });

    Some(TracedPath {
        from,
        steps: route,
        months,
        mode,
        blocked_from,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::graph::Direction;
    use crate::movement::orders::parse_move;
    use crate::report::model::Coordinate;
    use crate::report::{parse_report_full, ParsedReport};

    fn at(x: i32, y: i32) -> Coordinate {
        Coordinate { x, y, z: 1 }
    }

    fn ruleset() -> Ruleset {
        Ruleset::from_json(include_str!("../../../../config/public/ruleset.json"))
            .expect("the committed ruleset loads")
    }

    /// A chain of hexes running southeast, each naming the next, with a walker in the first.
    /// Mirrors the corridor the planner's acceptance tests use.
    fn corridor(terrains: &[&str]) -> ParsedReport {
        let mut text = String::from("Foo (1) Report\n\n");
        for (index, terrain) in terrains.iter().enumerate() {
            let x = 1 + index as i32;
            let y = 1 + index as i32;
            text.push_str(&format!(
                "{terrain} ({x},{y}) in Nowhere, 10 peasants (orcs), $5.\n\n"
            ));
            text.push_str("Exits:\n");
            if index > 0 {
                text.push_str(&format!(
                    "  Northwest : {} ({},{}) in Nowhere.\n",
                    terrains[index - 1],
                    x - 1,
                    y - 1
                ));
            }
            if index + 1 < terrains.len() {
                text.push_str(&format!(
                    "  Southeast : {} ({},{}) in Nowhere.\n",
                    terrains[index + 1],
                    x + 1,
                    y + 1
                ));
            }
            text.push('\n');
            if index == 0 {
                text.push_str(
                    "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n",
                );
            }
        }
        parse_report_full(&text)
    }

    fn trace(report: &ParsedReport, order: &str) -> Option<TracedPath> {
        let map = MapKnowledge::from_report(report);
        let unit = report
            .units()
            .find(|unit| unit.unit_id == "900")
            .expect("the synthetic report carries the walker")
            .clone();
        trace_move(
            &map,
            &ruleset(),
            &unit,
            &parse_move(order).expect("a readable order"),
        )
    }

    #[test]
    fn a_step_the_report_describes_keeps_its_real_terrain_and_cost() {
        let path = trace(&corridor(&["plain", "mountain"]), "MOVE SE").expect("an origin");

        assert_eq!(path.from, at(1, 1));
        assert_eq!(path.steps.len(), 1);
        assert_eq!(path.steps[0].direction, Direction::Southeast);
        assert_eq!(path.steps[0].to, at(2, 2));
        assert_eq!(path.steps[0].terrain, "mountain");
        assert_eq!(path.steps[0].cost, 2, "mountain is difficult going");
        assert!(!path.steps[0].road);
        assert_eq!(path.mode, Some(MovementMode::Walk));
    }

    /// An order into country nobody has described keeps going by arithmetic. The order is the
    /// player's stated intent, and stopping where the map stops would hide most of it.
    #[test]
    fn an_order_past_the_known_map_carries_on_geometrically() {
        let path = trace(&corridor(&["plain"]), "MOVE SE SE").expect("an origin");

        assert_eq!(
            path.steps.iter().map(|step| step.to).collect::<Vec<_>>(),
            vec![at(2, 2), at(3, 3)],
            "each unknown step lands on the adjacent lattice point"
        );
    }

    /// The guessed terrain is the last one seen, and a guess feeds the next guess: fog beyond a
    /// mountain is costed as mountain the whole way.
    #[test]
    fn unknown_terrain_is_guessed_from_the_previous_hex() {
        let path = trace(&corridor(&["plain", "mountain"]), "MOVE SE SE SE").expect("an origin");

        assert_eq!(path.steps[0].terrain, "mountain");
        assert_eq!(
            path.steps[1].terrain, "mountain",
            "guessed from the last hex"
        );
        assert_eq!(path.steps[2].terrain, "mountain", "a guess feeds the next");
        assert_eq!(
            path.steps[1].cost, 2,
            "the guess carries the terrain's cost"
        );
        assert!(!path.steps[1].road, "roads are never guessed");
    }

    #[test]
    fn entering_and_leaving_structures_crosses_no_hexside() {
        let path = trace(&corridor(&["plain", "plain"]), "MOVE IN 4 OUT SE").expect("an origin");

        assert_eq!(path.steps.len(), 1, "only the SE step crosses a hexside");
        assert_eq!(path.steps[0].to, at(2, 2));
    }

    /// The month split must agree with the planner's: points carry over, so costs of 1, 2 and 1
    /// take a two-point walker two months, not three.
    #[test]
    fn the_months_carry_unspent_points_exactly_as_the_planner_does() {
        let path = trace(
            &corridor(&["plain", "plain", "mountain", "plain"]),
            "MOVE SE SE SE",
        )
        .expect("an origin");

        assert_eq!(
            path.steps.iter().map(|step| step.cost).collect::<Vec<_>>(),
            vec![1, 2, 1]
        );
        assert_eq!(path.months.len(), 2);
        assert_eq!(
            path.months[0].steps, 1,
            "one point saved in the first month"
        );
        assert_eq!(path.months[1].steps, 2);
        assert_eq!(path.months[1].ends_at, at(4, 4));
    }

    /// An overloaded unit's order is still drawn - the route is what the orders say - but its
    /// timing is unknowable, which the empty months and absent mode both say.
    #[test]
    fn an_overloaded_unit_gets_a_path_with_no_months() {
        let report = corridor(&["plain", "plain"]);
        let map = MapKnowledge::from_report(&report);
        let mut unit = report
            .units()
            .find(|unit| unit.unit_id == "900")
            .expect("the walker")
            .clone();
        unit.weight = Some(1000);

        let path = trace_move(
            &map,
            &ruleset(),
            &unit,
            &parse_move("MOVE SE").expect("a readable order"),
        )
        .expect("the path is still drawn");
        assert_eq!(path.mode, None);
        assert!(path.months.is_empty());
        assert_eq!(path.steps.len(), 1);
    }

    #[test]
    fn a_unit_whose_mobility_was_never_stated_gets_a_path_with_no_months() {
        let report = corridor(&["plain", "plain"]);
        let map = MapKnowledge::from_report(&report);
        let mut unit = report
            .units()
            .find(|unit| unit.unit_id == "900")
            .expect("the walker")
            .clone();
        unit.weight = None;
        unit.capacity = None;

        let path = trace_move(
            &map,
            &ruleset(),
            &unit,
            &parse_move("MOVE SE").expect("a readable order"),
        )
        .expect("the path is still drawn");
        assert_eq!(path.mode, None);
        assert!(path.months.is_empty());
    }

    #[test]
    fn a_unit_standing_nowhere_the_map_knows_cannot_be_traced() {
        let report = corridor(&["plain", "plain"]);
        let map = MapKnowledge::from_report(&report);
        let mut unit = report
            .units()
            .find(|unit| unit.unit_id == "900")
            .expect("the walker")
            .clone();
        unit.region_id = "1:99,99".to_string();

        assert_eq!(
            trace_move(
                &map,
                &ruleset(),
                &unit,
                &parse_move("MOVE SE").expect("a readable order"),
            ),
            None
        );
    }

    /// The trace shows intent, not legality: a walker ordered into the sea gets its path drawn
    /// and costed at the terrain's plain cost. The order validator is where the complaint lives.
    #[test]
    fn terrain_the_unit_cannot_legally_cross_is_still_drawn_and_costed() {
        let path = trace(&corridor(&["plain", "ocean"]), "MOVE SE").expect("an origin");

        assert_eq!(path.steps.len(), 1);
        assert_eq!(path.steps[0].terrain, "ocean");
        assert_eq!(path.steps[0].cost, 1, "ocean is not on the doubled list");
    }

    /// Drawn, but marked: the step into the sea and everything past it will not happen as
    /// written, and the path says from which step onward that is.
    #[test]
    fn the_path_says_where_the_sea_stops_it() {
        let path = trace(
            &corridor(&["plain", "plain", "ocean", "plain"]),
            "MOVE SE SE SE",
        )
        .expect("an origin");

        assert_eq!(
            path.blocked_from,
            Some(1),
            "the second step enters the ocean"
        );

        let clear =
            trace(&corridor(&["plain", "plain", "plain"]), "MOVE SE SE").expect("an origin");
        assert_eq!(clear.blocked_from, None, "nothing on this path blocks");
    }

    /// A guess can block too: fog beyond the sea is costed as sea, so the doubt starts at the
    /// first real ocean hex and never clears on invented ground.
    #[test]
    fn fog_guessed_as_ocean_stays_blocked() {
        let path = trace(&corridor(&["plain", "ocean"]), "MOVE SE SE").expect("an origin");

        assert_eq!(path.blocked_from, Some(0), "the first step is already sea");
        assert_eq!(
            path.steps[1].terrain, "ocean",
            "the guess carries the sea onward"
        );
    }

    /// The sea only stops what cannot fly over it, exactly as the planner rules it.
    #[test]
    fn a_flier_is_not_blocked_by_the_sea() {
        let mut text = String::from("Foo (1) Report\n\n");
        text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
        text.push_str("Exits:\n  Southeast : ocean (2,2) in Sea.\n\n");
        text.push_str(
            "* Flier (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 100/0/100/0.\n",
        );
        let report = parse_report_full(&text);

        let path = trace(&report, "MOVE SE").expect("an origin");
        assert_eq!(path.mode, Some(MovementMode::Fly));
        assert_eq!(path.blocked_from, None);
    }

    /// With no mode there is no legality to rule on, and the empty months already dot the whole
    /// path - a blocked index would be a second answer to the same question.
    #[test]
    fn a_unit_without_a_mode_has_no_blocked_step_either() {
        let report = corridor(&["plain", "ocean"]);
        let map = MapKnowledge::from_report(&report);
        let mut unit = report
            .units()
            .find(|unit| unit.unit_id == "900")
            .expect("the walker")
            .clone();
        unit.weight = Some(1000);

        let path = trace_move(
            &map,
            &ruleset(),
            &unit,
            &parse_move("MOVE SE").expect("a readable order"),
        )
        .expect("the path is still drawn");
        assert_eq!(path.blocked_from, None);
    }

    /// A terrain name the ruleset has never heard of must cost something rather than panic - the
    /// guess chain can only produce names the report contained, but the report is player input.
    #[test]
    fn a_terrain_the_ruleset_does_not_know_costs_the_normal_rate() {
        let path = trace(&corridor(&["plain", "crystalwaste"]), "MOVE SE SE").expect("an origin");

        assert_eq!(path.steps[0].cost, 1);
        assert_eq!(path.steps[1].terrain, "crystalwaste");
        assert_eq!(path.steps[1].cost, 1);
    }

    /// Where both sides carry a road the step is cheaper, exactly as the planner charges it.
    #[test]
    fn a_connected_road_halves_the_cost_of_a_known_step() {
        let mut text = String::from("Foo (1) Report\n\n");
        text.push_str("plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n");
        text.push_str("Exits:\n  Southeast : mountain (2,2) in Nowhere.\n\n");
        text.push_str("+ Road [1] : Road SE.\n\n");
        text.push_str(
            "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n",
        );
        text.push_str("mountain (2,2) in Nowhere, 10 peasants (orcs), $5.\n\n");
        text.push_str("Exits:\n  Northwest : plain (1,1) in Nowhere.\n\n");
        text.push_str("+ Road [2] : Road NW.\n");
        let report = parse_report_full(&text);

        let path = trace(&report, "MOVE SE").expect("an origin");
        assert_eq!(
            path.steps[0].cost, 1,
            "a mountain at two, halved by the road"
        );
        assert!(path.steps[0].road);
    }
}
