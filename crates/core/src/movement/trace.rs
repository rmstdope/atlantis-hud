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

use crate::movement::graph::{Direction, MapKnowledge};
use crate::movement::mode::{
    fleet_flies, fleet_of, fleet_sailing, mobility, swim_ability, Mobility,
};
use crate::movement::orders::{first_passage, MoveStep};
use crate::movement::plan::{
    base_terrain_cost, blocks, constrains_departure, leaving_land, refused_by_sailing_step,
    split_costs, step_cost, Hull, Isthmus, Journey, MonthLeg, RouteStep,
};
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
    /// The inner passage the route ran into, when it ran into one. [`steps`](Self::steps) ends
    /// where it begins.
    pub passage: Option<TracedPassage>,
}

/// Where a traced route ran into an inner passage, and what could not be drawn past it.
///
/// No report names where a passage comes out, so the route stops here rather than drawing the rest
/// of the journey in the hex the unit has just left.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracedPassage {
    /// The hex the passage was entered from, which is where the mark belongs.
    pub coordinate: crate::report::model::Coordinate,
    /// The structure as a sentence points at one: `Shaft [3]`.
    pub structure: String,
    /// Ordered steps after the passage that could not be placed.
    pub steps_after: usize,
    /// The entry hex's own terrain, so the far-side ring can name where the journey came from
    /// without the screen looking the hex up on a level it is not showing.
    pub terrain: String,
    /// Where the passage comes out and what the journey does there, when the faction has proved
    /// it. `None` is the unknown case: the route stops, and `steps_after` says what was dropped.
    pub exit: Option<TracedPassageExit>,
}

/// The far side of a passage the faction has crossed, and the journey that carries on there.
///
/// `rules/tableitemweights`: "the movement point cost is equal to the normal cost to enter the
/// destination region", which is what `cost` is - `base_terrain_cost` for the destination's terrain
/// and this journey's mode, never halved by a road and never zero.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TracedPassageExit {
    /// The hex the unit comes out in, which is where the far-side mark belongs.
    pub coordinate: crate::report::model::Coordinate,
    /// That hex's terrain, from the map where it describes the hex and from the memory otherwise.
    pub terrain: String,
    /// What the crossing costs: the cost of entering that region.
    pub cost: u32,
    /// The journey beyond, walked from the destination. Drawn on the destination's own level.
    pub steps: Vec<RouteStep>,
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
    ordered: Option<&crate::movement::fleet::OrderedUnits>,
) -> Option<TracedPath> {
    let origin = map.hex_of_unit(unit)?;
    let from = origin.coordinate;

    // The trace draws intent, not legality, so a fleet's crew shortfall never stops it here - only
    // whether the fleet's numbers can be priced at all decides whether Sail is drawn. Exactly the
    // planner's own inference otherwise: aboard a priceable fleet, the mode is Sail.
    let fleet = fleet_of(unit, origin, ordered);
    let sailing = fleet.and_then(|fleet| fleet_sailing(ruleset, origin, fleet, ordered));
    // The hull cannot change during a journey, so it is read once here and carried down to the
    // terrain test. `Hull::from_flies` is the only place `fleet_flies`'s three-way answer is
    // collapsed.
    let hull = fleet.map_or(Hull::Bound, |fleet| {
        Hull::from_flies(fleet_flies(fleet, Some(ruleset)))
    });
    let mode_and_points = match sailing {
        Some((_, _, speed)) => Some((MovementMode::Sail, speed)),
        None => match mobility(unit) {
            Mobility::Moves(mode) => Some((mode, ruleset.movement_points(mode))),
            Mobility::Overloaded | Mobility::Unstated => None,
        },
    };
    let mode = mode_and_points.map(|(mode, _)| mode);
    let journey =
        mode.map(|mode| Journey::enforced(mode, hull).with_swim(swim_ability(unit, ruleset)));

    // `IN` is travel through an inner passage to another region (`rules/move`, 4). Where the
    // faction has proved where one comes out the journey carries on there (`ah-3u7c.2.2`);
    // otherwise everything ordered after it is drawn nowhere rather than drawn from the hex the
    // unit has just left.
    let ordered_passage = first_passage(unit.structure_id.as_deref(), steps);
    let near_steps = ordered_passage
        .as_ref()
        .map_or(steps, |passage| &steps[..passage.before]);

    let near = walk(map, ruleset, journey, from, &origin.terrain, near_steps);

    // The structure is resolved against the hex the near walk finished in. Where the order named
    // none, the hex was never visited, or no structure there carries that id, nothing is claimed
    // about why the route is short - `accept on doubt`.
    let followed = ordered_passage.and_then(|ordered| {
        let structure_id = ordered.structure_id.clone()?;
        let structure = map
            .hex(near.position)?
            .structures
            .iter()
            .find(|structure| structure.structure_id == structure_id)?;
        let structure = crate::report::model::numbered_structure_label(structure);

        let crossed = map.passage(near.position, &structure_id).map(|known| {
            // The map is this turn's word and the memory an older turn's, so the map wins wherever
            // it describes the destination at all.
            let terrain = map.hex(known.destination).map_or_else(
                || known.destination_terrain.clone(),
                |hex| hex.terrain.clone(),
            );
            // A second `IN` in the tail is not followed: the tail's walk stops at it exactly as the
            // near walk stopped at this one, and what is left counts as steps that could not be
            // placed.
            let tail = &steps[ordered.before + 1..];
            let stopped_at = tail
                .iter()
                .position(|step| matches!(step, MoveStep::In))
                .unwrap_or(tail.len());
            let beyond = walk(
                map,
                ruleset,
                journey,
                known.destination,
                &terrain,
                &tail[..stopped_at],
            );
            let steps_after = tail[stopped_at..]
                .iter()
                .filter(|step| matches!(step, MoveStep::Go(_) | MoveStep::In))
                .count();

            let exit = TracedPassageExit {
                coordinate: known.destination,
                cost: journey
                    .map_or(0, |journey| base_terrain_cost(ruleset, journey.mode, &terrain)),
                terrain,
                steps: beyond.route,
            };
            (exit, beyond.blocked_from, steps_after)
        });

        let (exit, beyond_blocked, steps_after) = match crossed {
            Some((exit, blocked, after)) => (Some(exit), blocked, after),
            None => (None, None, ordered.steps_after),
        };

        Some((
            TracedPassage {
                coordinate: near.position,
                structure,
                steps_after,
                terrain: near.terrain.clone(),
                exit,
            },
            beyond_blocked,
        ))
    });
    let (passage, beyond_blocked) = match followed {
        Some((passage, blocked)) => (Some(passage), blocked),
        None => (None, None),
    };

    // Counted over the whole journey: the steps before the passage, then the crossing, then the
    // steps beyond. The crossing itself is never the blocked step - a passage's far side is a
    // region the game itself puts the unit in, so there is no terrain test to fail.
    let blocked_from = near
        .blocked_from
        .or_else(|| beyond_blocked.map(|index| near.route.len() + 1 + index));

    // The month split runs across the crossing, so a unit cannot cross a passage for free in a
    // month it could not afford.
    let mut arrivals: Vec<(u32, crate::report::model::Coordinate)> =
        near.route.iter().map(|step| (step.cost, step.to)).collect();
    if let Some(exit) = passage.as_ref().and_then(|passage| passage.exit.as_ref()) {
        arrivals.push((exit.cost, exit.coordinate));
        arrivals.extend(exit.steps.iter().map(|step| (step.cost, step.to)));
    }
    let months = mode_and_points.map_or_else(Vec::new, |(_, points_per_month)| {
        split_costs(points_per_month, from, &arrivals)
    });

    Some(TracedPath {
        from,
        steps: near.route,
        months,
        mode,
        blocked_from,
        passage,
    })
}

/// What one walk of a run of ordered steps produced.
struct Walked {
    route: Vec<RouteStep>,
    position: crate::report::model::Coordinate,
    terrain: String,
    blocked_from: Option<usize>,
}

/// Walks a run of ordered steps from one hex, exactly as a whole order used to be walked.
///
/// Run once over the steps before a passage and again, from the far side, over the steps after a
/// passage the faction has proved (`ah-3u7c.2.2`). The two halves are drawn on their own levels
/// and are never joined by a line.
fn walk(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Option<Journey>,
    from: crate::report::model::Coordinate,
    from_terrain: &str,
    steps: &[MoveStep],
) -> Walked {
    let mut position = from;
    let mut terrain = from_terrain.to_string();
    let mut route = Vec::new();
    let mut blocked_from = None;
    // `None` for the hex the order starts in: "Ships ending their movement in a land hex may sail
    // out along any side connecting to water", so the first step is a departure, never a
    // through-pass. A unit stepping out of a passage entered its hex by no side either.
    let mut entered_by: Option<Direction> = None;

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
                || map.geometric_neighbour(position, *direction),
                |(_, neighbour)| neighbour,
            );
        let next_terrain = map
            .hex(next)
            .map_or_else(|| terrain.clone(), |hex| hex.terrain.clone());

        // Without a mode the costs would be invented twice over, so they are left at zero and the
        // empty months say the timing is unknowable. `step_cost` refuses both undescribed hexes
        // and terrain the unit may not cross; either way the trace costs the terrain at face
        // value instead, because the order is drawn as written, not as permitted.
        let (mut cost, road) = journey.map_or((0, false), |journey| {
            step_cost(map, ruleset, journey, position, *direction, next).unwrap_or_else(|| {
                (
                    base_terrain_cost(ruleset, journey.mode, &next_terrain),
                    false,
                )
            })
        });

        // The first step the game would refuse marks everything after it as doubt. Judged by the
        // planner's own rule, so the two never disagree about what the sea stops.
        if blocked_from.is_none()
            && journey.is_some_and(|journey| {
                blocks(ruleset, map, journey, next, &next_terrain)
                    || refused_by_sailing_step(ruleset, journey, &terrain, &next_terrain)
            })
        {
            blocked_from = Some(route.len());
        }

        // The side restriction, judged by the planner's own rule for the same reason. The premium
        // is left where the rules charge it - on the edge that leaves the canal region - because
        // nothing displays a traced step's cost; only `split_into_months` reads it.
        let isthmus = journey.map_or(Isthmus::Free, |journey| {
            leaving_land(
                map, ruleset, journey, position, &terrain, entered_by, *direction,
            )
        });
        if blocked_from.is_none() && isthmus == Isthmus::Refused {
            blocked_from = Some(route.len());
        }
        if let Isthmus::ThroughCanal { cost: pass, .. } = &isthmus {
            cost += pass.saturating_sub(ruleset.sailing_flat_cost());
        }

        // The trace guesses wherever the map runs out, exactly as the planner does.
        let estimated = map.hex(next).is_none();
        route.push(RouteStep {
            direction: *direction,
            to: next,
            terrain: next_terrain.clone(),
            cost,
            road,
            estimated,
            // A guessed terrain is not a sighting, so an estimated step is never marked as water.
            over_water: !estimated && ruleset.is_water(&next_terrain),
            // A typed order has no list of steps anywhere in the application, so a traced step
            // never names a canal.
            canal: None,
        });
        entered_by = journey.and_then(|journey| {
            constrains_departure(ruleset, journey, &next_terrain).then_some(*direction)
        });
        position = next;
        terrain = next_terrain;
    }

    Walked {
        route,
        position,
        terrain,
        blocked_from,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::movement::graph::{Direction, MapGeometry};
    use crate::movement::orders::parse_move;
    use crate::report::model::Coordinate;
    use crate::report::{parse_report_full, ParsedReport};

    fn at(x: i32, y: i32) -> Coordinate {
        Coordinate { x, y, z: 1 }
    }

    fn ruleset() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
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
            None,
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

    /// Exact dimensions improve the fallback for unexplored country; they do not make arithmetic a
    /// better authority than the report. A player-entered width can be wrong where a reported
    /// neighbour cannot, so where the two disagree the report is still the map's own word.
    #[test]
    fn a_stated_exit_beats_the_arithmetic_even_when_the_map_shape_is_known() {
        let text = concat!(
            "Foo (1) Report\n\n",
            "plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n",
            "Exits:\n",
            "  Southeast : plain (0,2) in Nowhere.\n\n",
            "* Walker (900), Foo (1), leader [LEAD]. Weight: 10. Capacity: 0/0/15/0.\n\n",
            "plain (0,2) in Nowhere, 10 peasants (orcs), $5.\n\n",
            "Exits:\n",
            "  Northwest : plain (1,1) in Nowhere.\n\n",
        );
        let report = parse_report_full(text);
        // A shape that wraps nothing at this coordinate: arithmetic alone would say (2,2), while
        // the report says (0,2). The report has to win.
        let map = MapKnowledge::from_report(&report).with_geometry(Some(MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
        }));
        let unit = report
            .units()
            .find(|unit| unit.unit_id == "900")
            .expect("the synthetic report carries the walker")
            .clone();

        let path = trace_move(
            &map,
            &ruleset(),
            &unit,
            &parse_move("MOVE SE").expect("a readable order"),
            None,
        )
        .expect("an origin");

        assert_eq!(
            path.steps[0].to,
            at(0, 2),
            "the stated exit, not the computed one"
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

    /// `ENTER` and `OUT` move a unit within its hex, so they cross no hexside.
    ///
    /// The order used to read `MOVE IN 4 OUT SE`, and its `IN` was incidental to what it names.
    /// An `IN` is travel through an inner passage to another region (`rules/move`, 4) and now ends
    /// the route, which is what `a_passage_ends_the_route_and_nothing_after_it_is_placed` pins.
    #[test]
    fn entering_and_leaving_structures_crosses_no_hexside() {
        let path = trace(&corridor(&["plain", "plain"]), "MOVE 4 OUT SE").expect("an origin");

        assert_eq!(path.steps.len(), 1, "only the SE step crosses a hexside");
        assert_eq!(path.steps[0].to, at(2, 2));
        assert_eq!(path.passage, None, "no passage was ordered");
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
            None,
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
        // The settled movement too: `mobility` falls back to it when the report printed no weight
        // and capacity of its own, so leaving it set would state exactly what this pins as unstated
        // (`ah-4hux`).
        unit.movement = None;

        let path = trace_move(
            &map,
            &ruleset(),
            &unit,
            &parse_move("MOVE SE").expect("a readable order"),
            None,
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
                None,
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
            None,
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
