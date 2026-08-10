//! Working out how a unit gets from where it stands to where you want it.
//!
//! The search is a plain Dijkstra over hexes the faction knows, weighted by what the ruleset says
//! each terrain costs. Two things make it more than a shortest-path exercise.
//!
//! The first is that it refuses rather than guesses. A hex nobody has described has no terrain, so
//! a route through it would have an invented cost; the route stops and names the hex instead. The
//! same goes for water a unit cannot cross.
//!
//! The second is that months are not fixed budgets. The rules page says unspent movement points
//! carry from one month into the next, so a route costing four points takes a two-point walker two
//! months even when no single month can afford the middle step on its own. Packing each month
//! separately would waste the odd point and report a journey longer than the game will charge.

use std::collections::{BTreeMap, BinaryHeap};

use serde::{Deserialize, Serialize};

use crate::movement::graph::{Direction, MapKnowledge};
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
    /// Nothing is known about that hex, so a route to it would have an invented cost.
    UnknownHex { coordinate: Coordinate },
    /// The hexes are known but nothing joins them up.
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
    // "that hex is water" rather than the far less useful "no route".
    let target = map.hex(destination).ok_or(RouteProblem::UnknownHex {
        coordinate: destination,
    })?;
    if blocks(ruleset, mode, &target.terrain) {
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

/// Dijkstra over the known hexes.
fn cheapest_path(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    mode: MovementMode,
    origin: Coordinate,
    destination: Coordinate,
) -> Result<Vec<RouteStep>, RouteProblem> {
    // Ordered so the smallest cost comes off a max-heap first; the key is (cost, hex) so ties break
    // on a stable ordering rather than on hash iteration order.
    let mut frontier: BinaryHeap<std::cmp::Reverse<(u32, String)>> = BinaryHeap::new();
    let mut best: BTreeMap<String, u32> = BTreeMap::new();
    let mut came_from: BTreeMap<String, (Coordinate, RouteStep)> = BTreeMap::new();

    best.insert(origin.id(), 0);
    frontier.push(std::cmp::Reverse((0, origin.id())));

    while let Some(std::cmp::Reverse((cost, key))) = frontier.pop() {
        if key == destination.id() {
            return Ok(rebuild(&came_from, origin, destination));
        }
        if best.get(&key).is_some_and(|known| cost > *known) {
            continue;
        }

        let Some(here) = map.hex_by_key(&key).map(|hex| hex.coordinate) else {
            continue;
        };

        for (direction, neighbour) in map.neighbours(here) {
            let Some((step, road)) = step_cost(map, ruleset, mode, here, direction, neighbour)
            else {
                continue;
            };
            let total = cost + step;
            let neighbour_key = neighbour.id();
            if best
                .get(&neighbour_key)
                .is_some_and(|known| total >= *known)
            {
                continue;
            }

            best.insert(neighbour_key.clone(), total);
            came_from.insert(
                neighbour_key.clone(),
                (
                    here,
                    RouteStep {
                        direction,
                        to: neighbour,
                        terrain: map
                            .hex(neighbour)
                            .map(|hex| hex.terrain.clone())
                            .unwrap_or_default(),
                        cost: step,
                        road,
                    },
                ),
            );
            frontier.push(std::cmp::Reverse((total, neighbour_key)));
        }
    }

    Err(RouteProblem::NoKnownRoute)
}

fn rebuild(
    came_from: &BTreeMap<String, (Coordinate, RouteStep)>,
    origin: Coordinate,
    destination: Coordinate,
) -> Vec<RouteStep> {
    let mut steps = Vec::new();
    let mut cursor = destination;

    while cursor != origin {
        let Some((previous, step)) = came_from.get(&cursor.id()) else {
            break;
        };
        steps.push(step.clone());
        cursor = *previous;
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
