//! Working out how a unit gets from where it stands to where you want it.
//!
//! The search is a plain Dijkstra weighted by what the ruleset says each terrain costs. Three
//! things make it more than a shortest-path exercise.
//!
//! The first is unexplored country. A player is told coordinates by an ally and wants to know how
//! far away they are, so a route to a hex nobody has described crosses the fog rather than refusing
//! at the fringe of what is known. Every such step is taken for the terrain of the hex behind it -
//! biomes cluster, and it is the same assumption [`crate::movement::trace`] makes when it draws a
//! written MOVE into the fog - and every such step is marked [`RouteStep::estimated`], because a
//! guessed cost presented as a real one is worse than no cost at all. Two rules keep the guessing
//! to what was asked for:
//!
//! - A route to a hex the map *does* describe never leaves described ground. Otherwise a walker
//!   facing a known sea would be sent round it through hexes nobody has ever seen, which may well
//!   be more sea; "there is no way there" is the better answer, and it is the true one.
//! - A route to an unexplored hex takes as few unexplored steps as it can, and only then the
//!   cheapest of those. It hugs the ground the faction knows for as long as that ground leads
//!   anywhere useful, rather than striking out across the fog because the guess happens to be
//!   cheaper than the mountains it can see.
//!
//! Water the unit cannot cross is still a hard refusal wherever the map actually says water.
//!
//! The second is that the fog is infinite and the search must not be. It may only wander a little
//! way outside the rectangle holding the ground the faction knows, the unit and the destination,
//! which is finite whatever the player clicks on.
//!
//! The third is that months are not fixed budgets. The rules page says unspent movement points
//! carry from one month into the next, so a route costing four points takes a two-point walker two
//! months even when no single month can afford the middle step on its own. Packing each month
//! separately would waste the odd point and report a journey longer than the game will charge.

use std::collections::{BTreeMap, BinaryHeap};

use serde::{Deserialize, Serialize};

use crate::movement::graph::{geometric_neighbour, Direction, MapKnowledge};
use crate::movement::mode::{mobility, Mobility};
use crate::movement::rules::{MovementMode, Ruleset};
use crate::report::model::{Coordinate, ReportUnit};

/// Why a route could not be planned.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum RouteProblem {
    /// Orders can only be written for your own units.
    NotYourUnit,
    /// The unit's weight exceeds every one of its capacities, so the game refuses it a MOVE order.
    Overloaded,
    /// The report did not state this unit's weight and capacity, so nothing can be planned.
    MobilityUnstated,
    /// The unit is already standing there.
    AlreadyThere,
    /// Nothing joins the two hexes up.
    NoKnownRoute,
    /// The map does not know the hex the unit is standing in, so there is nothing to plan from.
    OriginUnknown,
    /// The way lies across water, which needs a ship.
    OceanNeedsShip { coordinate: Coordinate },
    /// A flying route would have a month end over water, and a unit that ends a turn over water
    /// drowns.
    ///
    /// This is a statement about the single MOVE order a plan becomes, not about the journey being
    /// impossible. One MOVE runs greedily until it completes - the rules page says unspent points
    /// carry over "if a MOVE command did not complete in the month" - so the unit cannot choose to
    /// stop on an island part-way. Reaching the far side may still be possible by ordering the
    /// crossing a month at a time, which this planner does not do.
    FlightWouldEndOverOcean { coordinate: Coordinate },
}

/// One hex entered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStep {
    pub direction: Direction,
    pub to: Coordinate,
    pub terrain: String,
    pub cost: u32,
    /// Whether a road connected both sides and halved the cost.
    pub road: bool,
    /// Whether the terrain and the cost are guesses rather than anything a report stated.
    ///
    /// True for a step into unexplored country, which is costed as the terrain of the hex it was
    /// entered from. Nothing about such a step is knowledge, and a caller must say so.
    pub estimated: bool,
}

/// Where the unit stands when a month runs out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthLeg {
    /// Counted from the coming month, which is one.
    pub month: u32,
    /// How many steps were taken during it. Zero when the whole month goes on saving points.
    pub steps: usize,
    pub ends_at: Coordinate,
}

/// A route the unit could take.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlan {
    pub from: Coordinate,
    pub to: Coordinate,
    pub mode: MovementMode,
    pub steps: Vec<RouteStep>,
    pub total_cost: u32,
    pub months: Vec<MonthLeg>,
}

/// Plans the cheapest route a unit can take to a hex.
///
/// # Errors
///
/// Returns a [`RouteProblem`] naming what stopped it, rather than a route it cannot stand behind.
pub fn plan_route(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    unit: &ReportUnit,
    destination: Coordinate,
) -> Result<RoutePlan, RouteProblem> {
    if !unit.own {
        return Err(RouteProblem::NotYourUnit);
    }

    let mode = match mobility(unit) {
        Mobility::Moves(mode) => mode,
        Mobility::Overloaded => return Err(RouteProblem::Overloaded),
        Mobility::Unstated => return Err(RouteProblem::MobilityUnstated),
    };

    let origin = map
        .hex_of_unit(unit)
        .ok_or(RouteProblem::OriginUnknown)?
        .coordinate;
    if origin == destination {
        return Err(RouteProblem::AlreadyThere);
    }

    // Refuse the two cases whose reason is worth naming before searching, so the answer is
    // "that hex is water" rather than the far less useful "no route". An unexplored destination is
    // neither: nothing says it is water, so the route goes and the estimate says what it is worth.
    if map
        .hex(destination)
        .is_some_and(|target| blocks(ruleset, mode, &target.terrain))
    {
        return Err(RouteProblem::OceanNeedsShip {
            coordinate: destination,
        });
    }
    if map
        .hex(origin)
        .is_some_and(|here| blocks(ruleset, mode, &here.terrain))
    {
        return Err(RouteProblem::OceanNeedsShip { coordinate: origin });
    }

    let steps = match cheapest_path(map, ruleset, mode, origin, destination) {
        Ok(steps) => steps,
        Err(RouteProblem::NoKnownRoute) => {
            // "No known route" is a poor answer when the only thing in the way is water. Ask again
            // as though the unit could swim: if that finds a path, the sea is the reason, and
            // naming the hex it founders at is what makes the refusal actionable.
            return Err(blocked_by_water(map, ruleset, mode, origin, destination)
                .unwrap_or(RouteProblem::NoKnownRoute));
        }
        Err(other) => return Err(other),
    };
    let total_cost = steps.iter().map(|step| step.cost).sum();
    let months = split_into_months(ruleset, mode, origin, &steps);

    // A flying unit that ends a turn over water drowns, so a month may not run out mid-sea. The
    // months are cut greedily on purpose: that is how the engine executes a single MOVE order, so
    // planning a stop the engine would not make would be planning a drowning.
    if flies(mode) && ruleset.flight_must_end_on_land() {
        for leg in &months {
            let over_water = map
                .hex(leg.ends_at)
                .is_some_and(|hex| ruleset.is_water(&hex.terrain));
            if over_water {
                return Err(RouteProblem::FlightWouldEndOverOcean {
                    coordinate: leg.ends_at,
                });
            }
        }
    }

    Ok(RoutePlan {
        from: origin,
        to: destination,
        mode,
        steps,
        total_cost,
        months,
    })
}

fn flies(mode: MovementMode) -> bool {
    matches!(mode, MovementMode::Fly)
}

/// Whether this terrain stops this unit.
///
/// Reads the ruleset's own water rule rather than assuming it: a game that let anyone cross water
/// would otherwise be quietly overruled by a hardcoded belief.
///
/// Shared with the order tracer, which draws the blocked step anyway and marks it as doubt.
pub(crate) fn blocks(ruleset: &Ruleset, mode: MovementMode, terrain: &str) -> bool {
    ruleset.is_water(terrain) && ruleset.water_needs_a_ship() && !flies(mode)
}

/// Whether water is the only thing standing between the unit and its destination.
///
/// Re-runs the search with the water rule lifted. A path that appears only under that relaxation
/// means the sea is the obstacle, so the refusal can name the hex the unit would founder at rather
/// than shrugging.
fn blocked_by_water(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    mode: MovementMode,
    origin: Coordinate,
    destination: Coordinate,
) -> Option<RouteProblem> {
    if flies(mode) {
        return None;
    }

    let swimming = cheapest_path(map, ruleset, MovementMode::Fly, origin, destination).ok()?;
    let founders = swimming.iter().find(|step| {
        map.hex(step.to)
            .is_some_and(|hex| ruleset.is_water(&hex.terrain))
    })?;

    Some(RouteProblem::OceanNeedsShip {
        coordinate: founders.to,
    })
}

/// What entering `into` costs from `from`, or `None` when the unit may not go there at all.
///
/// Shared with the order tracer, which uses the refusal as its cue to guess instead.
pub(crate) fn step_cost(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    mode: MovementMode,
    from: Coordinate,
    direction: Direction,
    into: Coordinate,
) -> Option<(u32, bool)> {
    // An undescribed hex has no terrain, so a step into it would cost whatever we invented.
    let hex = map.hex(into)?;

    if blocks(ruleset, mode, &hex.terrain) {
        return None;
    }

    let base = ruleset.terrain_cost(&hex.terrain, mode);
    let road = map.road_connects_to(from, direction, into);
    Some((if road { ruleset.road_cost(base) } else { base }, road))
}

/// How far outside the ground the faction knows the search may wander.
///
/// The fog is unbounded, so something has to say where the search stops. A couple of hexes past the
/// rectangle holding the known world, the unit and the destination is enough to walk round the
/// outside of an obstacle at the fringe, and it keeps a click a long way off the map finite: the
/// rectangle grows to hold the destination and no further.
const FOG_MARGIN: i32 = 2;

/// The rectangle the search may not leave.
struct SearchArea {
    min_x: i32,
    max_x: i32,
    min_y: i32,
    max_y: i32,
}

impl SearchArea {
    fn around(map: &MapKnowledge, origin: Coordinate, destination: Coordinate) -> Self {
        let mut area = Self {
            min_x: origin.x.min(destination.x),
            max_x: origin.x.max(destination.x),
            min_y: origin.y.min(destination.y),
            max_y: origin.y.max(destination.y),
        };
        for known in map.coordinates() {
            area.min_x = area.min_x.min(known.x);
            area.max_x = area.max_x.max(known.x);
            area.min_y = area.min_y.min(known.y);
            area.max_y = area.max_y.max(known.y);
        }
        area.min_x -= FOG_MARGIN;
        area.max_x += FOG_MARGIN;
        area.min_y -= FOG_MARGIN;
        area.max_y += FOG_MARGIN;
        area
    }

    fn holds(&self, coordinate: Coordinate) -> bool {
        coordinate.x >= self.min_x
            && coordinate.x <= self.max_x
            && coordinate.y >= self.min_y
            && coordinate.y <= self.max_y
    }
}

/// What a route is judged on, cheapest first.
///
/// Unexplored steps come before movement points because they are a different currency: one is a
/// number the game will charge, the other is how much of the answer was invented. A player asking
/// for a hex out in the fog wants the least invention that gets them there, and among those the
/// cheapest walk.
type Price = (usize, u32);

/// Where the route stands: a hex, and the terrain it is being taken for.
///
/// The terrain is part of the state rather than a property of the hex because an unexplored hex has
/// none of its own: it is taken for whatever the route carried into it, so the cost of the step
/// after it depends on how it was reached. For a hex the map describes the terrain is always that
/// hex's own, so everywhere outside the fog this collapses back to the hex and the search is the
/// same Dijkstra it always was.
type Standing = (String, String);

/// Dijkstra over the known hexes, and over the fog around them.
fn cheapest_path(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    mode: MovementMode,
    origin: Coordinate,
    destination: Coordinate,
) -> Result<Vec<RouteStep>, RouteProblem> {
    // Guessing is for reaching a hex the map cannot describe. Where it can, the described ground is
    // the whole answer, and a detour through country nobody has seen is not an improvement on it.
    let may_guess = map.hex(destination).is_none();
    let area = SearchArea::around(map, origin, destination);
    let origin_terrain = map
        .hex(origin)
        .map(|hex| hex.terrain.clone())
        .unwrap_or_default();

    // Ordered so the cheapest comes off a max-heap first; the key is (price, standing) so ties break
    // on a stable ordering rather than on hash iteration order.
    let mut frontier: BinaryHeap<std::cmp::Reverse<(Price, Standing)>> = BinaryHeap::new();
    let mut best: BTreeMap<Standing, Price> = BTreeMap::new();
    let mut came_from: BTreeMap<Standing, (Standing, RouteStep)> = BTreeMap::new();
    // Where each hex the search has reached actually is. A hex the map has never heard of cannot be
    // looked up, so the search remembers the coordinate it arrived at.
    let mut position: BTreeMap<String, Coordinate> = BTreeMap::new();

    let start: Standing = (origin.id(), origin_terrain);
    position.insert(origin.id(), origin);
    best.insert(start.clone(), (0, 0));
    frontier.push(std::cmp::Reverse(((0, 0), start.clone())));

    while let Some(std::cmp::Reverse((price, standing))) = frontier.pop() {
        if standing.0 == destination.id() {
            return Ok(rebuild(&came_from, &start, &standing));
        }
        if best.get(&standing).is_some_and(|known| price > *known) {
            continue;
        }

        let Some(here) = position.get(&standing.0).copied() else {
            continue;
        };

        for (direction, neighbour) in ways_out(map, here) {
            if !area.holds(neighbour) || (!may_guess && map.hex(neighbour).is_none()) {
                continue;
            }
            let Some(step) = step_into(map, ruleset, mode, here, &standing.1, direction, neighbour)
            else {
                continue;
            };
            let total: Price = (price.0 + usize::from(step.estimated), price.1 + step.cost);
            let reached: Standing = (neighbour.id(), step.terrain.clone());
            if best.get(&reached).is_some_and(|known| total >= *known) {
                continue;
            }

            position.entry(neighbour.id()).or_insert(neighbour);
            best.insert(reached.clone(), total);
            came_from.insert(
                reached.clone(),
                (
                    standing.clone(),
                    RouteStep {
                        direction,
                        to: neighbour,
                        terrain: step.terrain,
                        cost: step.cost,
                        road: step.road,
                        estimated: step.estimated,
                    },
                ),
            );
            frontier.push(std::cmp::Reverse((total, reached)));
        }
    }

    Err(RouteProblem::NoKnownRoute)
}

/// Every way out of a hex: the exits the reports state, and arithmetic into the fog.
///
/// A stated exit is the map's own word and survives the wrap seam, so it always wins. Arithmetic is
/// the same deliberate exception the order tracer makes, and it is what lets a route leave the
/// fringe of the known world at all: a hex nobody has described states no exits.
///
/// It is used only for a step into unexplored ground. Two hexes the reports both describe are
/// neighbours when a report says they are and not otherwise - the map wraps east to west and
/// nothing says where the seam is, so a computed adjacency between two known hexes would be a
/// crossing the reports had every chance to mention and did not.
fn ways_out(map: &MapKnowledge, here: Coordinate) -> Vec<(Direction, Coordinate)> {
    let mut ways: Vec<(Direction, Coordinate)> = map.neighbours(here).collect();
    for direction in Direction::ALL {
        let guessed = geometric_neighbour(here, direction);
        if map.hex(guessed).is_none() && !ways.iter().any(|(stated, _)| *stated == direction) {
            ways.push((direction, guessed));
        }
    }
    ways
}

/// What one step costs, and what is known about the hex it lands in.
struct Step {
    cost: u32,
    road: bool,
    terrain: String,
    estimated: bool,
}

/// Entering a hex, described or not.
///
/// A described hex is costed by [`step_cost`], which also refuses the ones the unit may not enter.
/// An unexplored one is taken for the terrain behind it, and marked so nobody mistakes the number
/// for a fact.
fn step_into(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    mode: MovementMode,
    from: Coordinate,
    carried: &str,
    direction: Direction,
    into: Coordinate,
) -> Option<Step> {
    if let Some(hex) = map.hex(into) {
        let (cost, road) = step_cost(map, ruleset, mode, from, direction, into)?;
        return Some(Step {
            cost,
            road,
            terrain: hex.terrain.clone(),
            estimated: false,
        });
    }

    // A route that is already at sea - a unit aboard a fleet - would be guessing itself further out
    // to sea, and the sea is exactly what a walker may not cross.
    if blocks(ruleset, mode, carried) {
        return None;
    }
    Some(Step {
        cost: ruleset.terrain_cost(carried, mode),
        road: false,
        terrain: carried.to_string(),
        estimated: true,
    })
}

fn rebuild(
    came_from: &BTreeMap<Standing, (Standing, RouteStep)>,
    start: &Standing,
    arrival: &Standing,
) -> Vec<RouteStep> {
    let mut steps = Vec::new();
    let mut cursor = arrival.clone();

    while cursor != *start {
        let Some((previous, step)) = came_from.get(&cursor) else {
            break;
        };
        steps.push(step.clone());
        cursor = previous.clone();
    }

    steps.reverse();
    steps
}

/// Walks the route month by month, saving what a month cannot spend.
///
/// The rules page is explicit that points carry over, which is why this accumulates rather than
/// giving each month a fresh budget: costs of one, two and one take a two-point walker two months,
/// not three.
/// Shared with the order tracer, so a drawn order and a planned route split identically.
pub(crate) fn split_into_months(
    ruleset: &Ruleset,
    mode: MovementMode,
    origin: Coordinate,
    steps: &[RouteStep],
) -> Vec<MonthLeg> {
    let allowance = ruleset.movement_points(mode);
    let mut months = Vec::new();

    // `Ruleset::from_json` refuses a zero allowance, but a `Ruleset` deserialized by any other
    // route would not have been through that check, and zero here never advances the route.
    if allowance == 0 {
        return months;
    }

    let mut position = origin;
    let mut taken = 0;
    let mut points = 0_u32;
    let mut month = 0_u32;

    while taken < steps.len() {
        month += 1;
        points += allowance;
        let mut this_month = 0;

        while let Some(step) = steps.get(taken) {
            if step.cost > points {
                break;
            }
            points -= step.cost;
            position = step.to;
            taken += 1;
            this_month += 1;
        }

        months.push(MonthLeg {
            month,
            steps: this_month,
            ends_at: position,
        });
    }

    months
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::parse_report_full;

    /// Nothing in a single report can reach a hex the map has never heard of: neighbours come from
    /// exits, and every exit hex is entered into the map as it is built. The guard in `step_cost`
    /// is therefore unreachable through `plan_route` today, and will stop being so once sightings
    /// are carried across turns and a remembered hex names a neighbour nobody has since described.
    ///
    /// Mutating the guard away broke no acceptance test, which is exactly why it is pinned here
    /// instead of left to look covered.
    #[test]
    fn a_step_into_a_hex_nothing_is_known_about_has_no_cost_at_all() {
        let report = parse_report_full(
            "Foo (1) Report\n\n\
             plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
             Exits:\n  Southeast : plain (2,2) in Nowhere.\n",
        );
        let map = MapKnowledge::from_report(&report);
        let ruleset = Ruleset::from_json(include_str!("../../../../config/public/ruleset.json"))
            .expect("the committed ruleset loads");

        let here = Coordinate { x: 1, y: 1, z: 1 };
        let described = Coordinate { x: 2, y: 2, z: 1 };
        let undescribed = Coordinate { x: 9, y: 9, z: 1 };

        assert_eq!(
            step_cost(
                &map,
                &ruleset,
                MovementMode::Walk,
                here,
                Direction::Southeast,
                described
            ),
            Some((1, false)),
            "a described neighbour costs what its terrain costs"
        );
        assert_eq!(
            step_cost(
                &map,
                &ruleset,
                MovementMode::Walk,
                here,
                Direction::Southeast,
                undescribed
            ),
            None,
            "an undescribed hex must refuse rather than invent a cost"
        );
    }
}
