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

use crate::movement::graph::{Direction, KnownHex, MapKnowledge};
use crate::movement::mode::{fleet_of, fleet_sailing, mobility_with_ruleset, Mobility};
use crate::movement::orders::{render_move, render_sail, MoveStep};
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
    /// The unit is aboard a fleet whose crew does not hold enough sailing skill between them to
    /// sail it - "there must be enough sailors aboard ... to sail the fleet, or it will not go
    /// anywhere."
    CrewCannotSail { required: i64, available: i64 },
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
    /// The order this route becomes, exactly as the shell writes it into the unit's block:
    /// `SAIL …` for a fleet, `MOVE …` for everything else (a flier and a rider MOVE too).
    pub order: String,
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

    let origin_hex = map.hex_of_unit(unit).ok_or(RouteProblem::OriginUnknown)?;
    let origin = origin_hex.coordinate;

    // Aboard a sailable fleet, the mode is Sail and there is nothing else to ask: the fleet's
    // numbers decide, not the rider's own walking capacity. Asking `mobility()` first is the trap -
    // a sailor aboard ship still states a personal Weight/Capacity line, so the ordinary land
    // question would happily answer Walk for someone standing at sea. An unknown hull (no ruleset
    // entry and no server-stated numbers) falls back to the land question as if the unit were not
    // aboard at all, rather than guessing a ship's speed.
    let (mode, points_per_month) = match sail_mode(ruleset, unit, origin_hex)? {
        Some(resolved) => resolved,
        None => match mobility_with_ruleset(unit, ruleset) {
            Mobility::Moves(mode) => (mode, ruleset.movement_points(mode)),
            Mobility::Overloaded => return Err(RouteProblem::Overloaded),
            Mobility::Unstated => return Err(RouteProblem::MobilityUnstated),
        },
    };

    if origin == destination {
        return Err(RouteProblem::AlreadyThere);
    }

    let (steps, months) =
        route_for_mode(map, ruleset, mode, points_per_month, origin, destination)?;
    let total_cost = steps.iter().map(|step| step.cost).sum();

    let moves: Vec<MoveStep> = steps
        .iter()
        .map(|step| MoveStep::Go(step.direction))
        .collect();
    let order = if matches!(mode, MovementMode::Sail) {
        render_sail(&moves)
    } else {
        render_move(&moves)
    };

    Ok(RoutePlan {
        from: origin,
        to: destination,
        mode,
        steps,
        total_cost,
        months,
        order,
    })
}

/// The cheapest route between two hexes for one way of travelling, and how the months fall.
///
/// What [`plan_route`] does once it knows a unit's mode: the two water guards, [`cheapest_path`]
/// with its [`blocked_by_water`] fallback, [`split_into_months`], and the flight-must-end-on-land
/// rule. `crate::trade` asks the same question of a hypothetical traveller rather than a unit's
/// own. Sharing this is what stops the two disagreeing about whether a flier may end a month over
/// water.
///
/// `points_per_month` is taken rather than resolved from `ruleset` here, because a fleet's speed is
/// not in the ruleset's per-mode table at all - it comes from the fleet itself. A caller asking
/// about `Walk`, `Ride` or `Fly` passes `ruleset.movement_points(mode)`; `plan_route` passes the
/// fleet's own resolved speed for `Sail`.
///
/// # Errors
///
/// Returns a [`RouteProblem`] naming what stopped the route, rather than one it cannot stand
/// behind.
pub(crate) fn route_for_mode(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    mode: MovementMode,
    points_per_month: u32,
    origin: Coordinate,
    destination: Coordinate,
) -> Result<(Vec<RouteStep>, Vec<MonthLeg>), RouteProblem> {
    // Refuse the two cases whose reason is worth naming before searching, so the answer is
    // "that hex is water" rather than the far less useful "no route". An unexplored destination is
    // neither: nothing says it is water, so the route goes and the estimate says what it is worth.
    if map
        .hex(destination)
        .is_some_and(|target| blocks(ruleset, map, mode, destination, &target.terrain))
    {
        return Err(RouteProblem::OceanNeedsShip {
            coordinate: destination,
        });
    }
    if map
        .hex(origin)
        .is_some_and(|here| blocks(ruleset, map, mode, origin, &here.terrain))
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
    let months = split_into_months(points_per_month, origin, &steps);

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

    Ok((steps, months))
}

fn flies(mode: MovementMode) -> bool {
    matches!(mode, MovementMode::Fly)
}

/// Whether the unit standing in `origin_hex` is aboard a fleet whose numbers can be priced, and if
/// so, what it costs to refuse or to sail.
///
/// `Ok(None)` when the unit is not aboard a fleet at all, or is aboard one no source can price -
/// both cases fall through to the ordinary land `mobility` question, because neither is a reason to
/// invent a number. `Err` only for a fleet that *can* be priced but whose crew falls short.
fn sail_mode(
    ruleset: &Ruleset,
    unit: &ReportUnit,
    origin_hex: &KnownHex,
) -> Result<Option<(MovementMode, u32)>, RouteProblem> {
    // The planner answers from the report on purpose, and passes no orders view below to say so.
    // It is
    // asked "where could this unit get to", which is a question about the turn as it stands rather
    // than about the orders currently in the editor - and it is handed no orders document to read
    // (`plan_route`'s callers, down from `plan_for_remembered_report`, pass none). The tracer and
    // the units-in-hex preview do answer after this month's ENTER and LEAVE, so the two
    // deliberately differ; the navigator settled that on 2026-08-18 (ah-ssd).
    let Some(fleet) = fleet_of(unit, origin_hex, None) else {
        return Ok(None);
    };
    let Some((required, available, speed)) = fleet_sailing(ruleset, origin_hex, fleet, None) else {
        return Ok(None);
    };
    if available < required {
        return Err(RouteProblem::CrewCannotSail {
            required,
            available,
        });
    }
    Ok(Some((MovementMode::Sail, speed)))
}

/// Whether this terrain stops this unit.
///
/// Reads the ruleset's own water rule rather than assuming it: a game that let anyone cross water
/// would otherwise be quietly overruled by a hardcoded belief. A fleet is the water rule turned
/// round: water never blocks it, and land blocks it unless the hex is coastal - "a non-ocean region
/// with at least one adjacent ocean region" - which is asked of the map itself, an estimated
/// neighbour (one the search only reached by geometric guess) never counting as confirming it.
///
/// Shared with the order tracer, which draws the blocked step anyway and marks it as doubt.
pub(crate) fn blocks(
    ruleset: &Ruleset,
    map: &MapKnowledge,
    mode: MovementMode,
    coordinate: Coordinate,
    terrain: &str,
) -> bool {
    if mode == MovementMode::Sail {
        if ruleset.is_water(terrain) {
            return false;
        }
        return ruleset.sailing_land_needs_coast() && !is_coastal(ruleset, map, coordinate);
    }
    ruleset.is_water(terrain) && ruleset.water_needs_a_ship() && !flies(mode)
}

/// Whether a hex has at least one neighbour the map itself describes as water.
fn is_coastal(ruleset: &Ruleset, map: &MapKnowledge, coordinate: Coordinate) -> bool {
    map.neighbours(coordinate).any(|(_, neighbour)| {
        map.hex(neighbour)
            .is_some_and(|hex| ruleset.is_water(&hex.terrain))
    })
}

/// What entering this terrain costs, absent a road - the number [`step_cost`] uses wherever it does
/// not refuse. A fleet's is the flat cost the sailing rule states, never the terrain premium.
///
/// Shared with the order tracer, whose fallback needs the same figure for a step it draws but
/// cannot legally cost.
pub(crate) fn base_terrain_cost(ruleset: &Ruleset, mode: MovementMode, terrain: &str) -> u32 {
    if mode == MovementMode::Sail {
        ruleset.sailing_flat_cost()
    } else {
        ruleset.terrain_cost(terrain, mode)
    }
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
    // A fleet already crosses water freely, so the "what if it could swim" probe answers a
    // question Sail does not have.
    if flies(mode) || mode == MovementMode::Sail {
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

    if blocks(ruleset, map, mode, into, &hex.terrain) {
        return None;
    }

    // A fleet's flat cost is the sailing rule itself, not the terrain premium, and no road ever
    // applies to it - roads help feet and hooves, not hulls.
    if mode == MovementMode::Sail {
        return Some((ruleset.sailing_flat_cost(), false));
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
/// It is confined to steps where one end is unexplored. Two hexes the reports both describe are
/// neighbours when a report says they are and not otherwise - the map wraps east to west and
/// nothing says where the seam is, so a computed adjacency between two known hexes would be a
/// crossing the reports had every chance to mention and did not. Standing *in* the fog there is no
/// such word to go on and no such objection: an unexplored hex states no exits at all, so
/// arithmetic is the only way on, and it is also what lets a route come back out onto described
/// ground rather than being stuck in the fog for the rest of the journey.
fn ways_out(map: &MapKnowledge, here: Coordinate) -> Vec<(Direction, Coordinate)> {
    let mut ways: Vec<(Direction, Coordinate)> = map.neighbours(here).collect();
    let in_the_fog = map.hex(here).is_none();
    for direction in Direction::ALL {
        let guessed = map.geometric_neighbour(here, direction);
        if (in_the_fog || map.hex(guessed).is_none())
            && !ways.iter().any(|(stated, _)| *stated == direction)
        {
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
    // to sea, and the sea is exactly what a walker may not cross. For a fleet the same guard asks
    // the opposite question: fog beyond the described map cannot be confirmed coastal, so a land
    // guess blocks it rather than assuming a way in.
    if blocks(ruleset, map, mode, into, carried) {
        return None;
    }
    Some(Step {
        cost: base_terrain_cost(ruleset, mode, carried),
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
///
/// Takes the resolved points a month buys rather than a mode, because a fleet's speed is not in the
/// ruleset's per-mode table at all - it comes from the fleet itself, resolved once by the caller
/// before this ever runs.
///
/// Shared with the order tracer, so a drawn order and a planned route split identically.
pub(crate) fn split_into_months(
    points_per_month: u32,
    origin: Coordinate,
    steps: &[RouteStep],
) -> Vec<MonthLeg> {
    let allowance = points_per_month;
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
        let ruleset = Ruleset::from_json(atlantis_hud_fixtures::RULESET_JSON)
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
