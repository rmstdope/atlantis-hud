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

use crate::movement::graph::{may_leave_land, Direction, KnownHex, MapKnowledge};
use crate::movement::mode::{
    cargo_capacity, fleet_flies, fleet_load, fleet_of, fleet_sailing, mobility_with_ruleset,
    swim_ability, Mobility, Swim,
};
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
    /// The way lies across water, which needs a ship. `terrain` is the water hex's own reported
    /// terrain, so the refusal can name a lake a lake.
    OceanNeedsShip {
        coordinate: Coordinate,
        terrain: String,
    },
    /// The destination is itself water. Separate from [`RouteProblem::OceanNeedsShip`] because "in
    /// the way" is untrue of the hex the player asked for, and a small inland lake is easy to click
    /// by accident.
    DestinationNeedsShip {
        coordinate: Coordinate,
        terrain: String,
    },
    /// A unit that can swim, but not carrying this much. The numbers say how much to put down,
    /// and a ship is never mentioned, because a ship is not what this unit needs.
    SwimLoadTooHeavy {
        coordinate: Coordinate,
        terrain: String,
        capacity: i64,
        load: i64,
        /// Whether this hex is the one the player clicked rather than one standing in the way.
        destination: bool,
    },
    /// Deep water, which a swimmer may enter only when sea creatures bear its whole weight.
    /// `borne` is what they can bear, and zero when there are none to name.
    DeepWaterNeedsSeaCreatures {
        coordinate: Coordinate,
        terrain: String,
        borne: i64,
        load: i64,
        destination: bool,
    },
    /// Whether this water is deep cannot be told: some hex beside it is unexplored. Refused rather
    /// than annotated - doubt about the cost of a step is a warning, doubt about whether it is
    /// legal at all is a refusal.
    WaterDepthUnknown {
        coordinate: Coordinate,
        terrain: String,
    },
    /// The report does not say what this unit can carry while swimming, so nothing can say whether
    /// it may enter this hex. Dry routes are unaffected.
    SwimCapacityUnstated {
        coordinate: Coordinate,
        terrain: String,
    },
    /// A flying route would have a month end over water, and a unit that ends a turn over water
    /// drowns.
    ///
    /// This is a statement about the single MOVE order a plan becomes, not about the journey being
    /// impossible. One MOVE runs greedily until it completes - the rules page says unspent points
    /// carry over "if a MOVE command did not complete in the month" - so the unit cannot choose to
    /// stop on an island part-way. Reaching the far side may still be possible by ordering the
    /// crossing a month at a time, which this planner does not do.
    FlightWouldEndOverOcean {
        coordinate: Coordinate,
        terrain: String,
    },
    /// The unit is aboard a fleet whose crew does not hold enough sailing skill between them to
    /// sail it - "there must be enough sailors aboard ... to sail the fleet, or it will not go
    /// anywhere."
    CrewCannotSail { required: i64, available: i64 },
    /// The fleet is carrying more than its hull holds, so the game will not move it - "A fleet can
    /// only move if the total weight of everything aboard does not exceed the fleet's capacity"
    /// (`rules/movement_sailing`). `crew` is `Some` when the crew falls short as well, so one
    /// sentence can name both faults and the player is not refused a second time for a reason
    /// nobody mentioned.
    #[serde(rename_all = "camelCase")]
    FleetOverloaded {
        load: i64,
        capacity: i64,
        crew: Option<CrewShortfall>,
    },
    /// The unit is aboard a fleet it does not own, and only the owner sets a fleet's course -
    /// "the owner of a fleet must issue the SAIL order" (`rules/movement_sailing`). Orders are only
    /// ever written to the unit the player picked, so there is nothing to plan for this one.
    #[serde(rename_all = "camelCase")]
    NotFleetOwner {
        /// `Marines (902)`, the unit the player picked.
        unit: String,
        /// `Longship [329]`, as `fleet_label` spells it.
        fleet: String,
        /// `Sea Rovers (900)`, the unit that can set the course.
        owner: String,
    },
    /// A fleet asked to step from one land hex straight into another, which the sailing rule
    /// allows in none of its three forms: "A fleet can move from an ocean region to another ocean
    /// region, or from a coastal region to an ocean region, or from an ocean region to a coastal
    /// region."
    ///
    /// Both hexes may be perfectly good coastal hexes, which is exactly why this is not
    /// [`RouteProblem::OceanNeedsShip`]: nothing is wrong with either end, only with the step
    /// between them.
    #[serde(rename_all = "camelCase")]
    SailNeedsOcean {
        from: Coordinate,
        from_terrain: String,
        to: Coordinate,
        to_terrain: String,
    },
    /// A fleet asked to sail through a land hex and out by one of the three sides the rule
    /// refuses, with no canal to lift it.
    ///
    /// `rules/movement_sailing`: "Ships may not sail through single hex land masses and must leave
    /// via the same side they entered or a side adjacent to that one." `coordinate` and `terrain`
    /// are the land hex the fleet could not get through, which is the hex the sentence names.
    IsthmusNeedsCanal {
        coordinate: Coordinate,
        terrain: String,
    },
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
    /// Whether this hex is water in this world. Never true for an estimated step: a guessed
    /// terrain is not a sighting, and the panel's unexplored warning speaks for that case.
    pub over_water: bool,
    /// The canal this step passed through, by its own name - `Canal`, `Mystic Canal` - and `None`
    /// for every other step. Set on the step that *entered* the canal region, which is also where
    /// its `cost` carries the through-pass price.
    #[serde(default)]
    pub canal: Option<String>,
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
    /// Whether the sailing weight check could not be made at all - a load or a capacity no source
    /// could give. The route stands; the panel says the check is missing. Always false for a
    /// walker, a rider and a flier, which this rule says nothing about.
    pub load_unchecked: bool,
}

/// A fleet's crew falling short, when it is not the only thing wrong.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrewShortfall {
    pub required: i64,
    pub available: i64,
}

/// What a priceable fleet under a unit costs to sail, once it is known it will move at all.
struct Sailing {
    points_per_month: u32,
    hull: Hull,
    /// See [`RoutePlan::load_unchecked`].
    load_unchecked: bool,
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
    let (mode, points_per_month, hull, load_unchecked) = match sail_mode(ruleset, unit, origin_hex)?
    {
        Some(sailing) => (
            MovementMode::Sail,
            sailing.points_per_month,
            sailing.hull,
            sailing.load_unchecked,
        ),
        None => match mobility_with_ruleset(unit, ruleset) {
            Mobility::Moves(mode) => (mode, ruleset.movement_points(mode), Hull::Bound, false),
            Mobility::Overloaded => return Err(RouteProblem::Overloaded),
            Mobility::Unstated => return Err(RouteProblem::MobilityUnstated),
        },
    };

    if origin == destination {
        return Err(RouteProblem::AlreadyThere);
    }

    let (steps, months) = route_for_mode(
        map,
        ruleset,
        Journey::enforced(mode, hull).with_swim(swim_ability(unit, ruleset)),
        points_per_month,
        origin,
        destination,
    )?;
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
        load_unchecked,
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
    journey: Journey,
    points_per_month: u32,
    origin: Coordinate,
    destination: Coordinate,
) -> Result<(Vec<RouteStep>, Vec<MonthLeg>), RouteProblem> {
    // Refuse the two cases whose reason is worth naming before searching, so the answer is
    // "that hex is water" rather than the far less useful "no route". An unexplored destination is
    // neither: nothing says it is water, so the route goes and the estimate says what it is worth.
    if let Some(target) = map.hex(destination) {
        if blocks(ruleset, map, journey, destination, &target.terrain) {
            // A water destination is the hex the player clicked on, and "in the way" is untrue of
            // it. Anything else blocked here - an inland hex a fleet cannot reach, say - keeps the
            // refusal it has always had, which is not about the destination being wet.
            return Err(
                water_refusal(ruleset, map, journey, destination, &target.terrain, true).unwrap_or(
                    RouteProblem::OceanNeedsShip {
                        coordinate: destination,
                        terrain: water_named(ruleset, &target.terrain),
                    },
                ),
            );
        }
    }
    if let Some(here) = map.hex(origin) {
        if blocks(ruleset, map, journey, origin, &here.terrain) {
            return Err(
                water_refusal(ruleset, map, journey, origin, &here.terrain, false).unwrap_or(
                    RouteProblem::OceanNeedsShip {
                        coordinate: origin,
                        terrain: water_named(ruleset, &here.terrain),
                    },
                ),
            );
        }
    }

    let (mut steps, passes) = match cheapest_path(map, ruleset, journey, origin, destination) {
        Ok(found) => found,
        Err(RouteProblem::NoKnownRoute) => {
            // "No known route" is a poor answer when the only thing in the way is water. Ask again
            // as though the unit could swim: if that finds a path, the sea is the reason, and
            // naming the hex it founders at is what makes the refusal actionable.
            return Err(blocked_by_water(map, ruleset, journey, origin, destination)
                .or_else(|| blocked_by_sailing_rule(map, ruleset, journey, origin, destination))
                .unwrap_or(RouteProblem::NoKnownRoute));
        }
        Err(other) => return Err(other),
    };
    // Split the months from the costs the game actually charges - the premium still sitting on the
    // edge that leaves the canal region - before moving it to where the player agreed to see it.
    let months = split_into_months(points_per_month, origin, &steps);
    shift_canal_premiums(&mut steps, passes);

    // A flying unit that ends a turn over water drowns, so a month may not run out mid-sea. The
    // months are cut greedily on purpose: that is how the engine executes a single MOVE order, so
    // planning a stop the engine would not make would be planning a drowning.
    if flies(journey.mode) && ruleset.flight_must_end_on_land() {
        for leg in &months {
            let wet = map
                .hex(leg.ends_at)
                .filter(|hex| ruleset.is_water(&hex.terrain));
            if let Some(hex) = wet {
                return Err(RouteProblem::FlightWouldEndOverOcean {
                    coordinate: leg.ends_at,
                    terrain: hex.terrain.clone(),
                });
            }
        }
    }

    Ok((steps, months))
}

/// The terrain [`RouteProblem::OceanNeedsShip`] should name for a hex the journey is blocked at.
///
/// Water names itself, so a lake is refused as a lake. A dry hex does not: `blocks` also refuses a
/// fleet an inland land hex, which has nothing to do with water, and naming it would print "the
/// plain is in the way, and crossing it needs a ship". That case keeps the world's own water word,
/// which is the sentence it has always been refused with.
fn water_named(ruleset: &Ruleset, terrain: &str) -> String {
    if ruleset.is_water(terrain) {
        terrain.to_string()
    } else {
        ruleset.movement.ocean.terrain.clone()
    }
}

fn flies(mode: MovementMode) -> bool {
    matches!(mode, MovementMode::Fly)
}

/// Whether the unit standing in `origin_hex` is aboard a fleet whose numbers can be priced, and if
/// so, what it costs to refuse or to sail.
///
/// `Ok(None)` when the unit is not aboard a fleet at all, or is aboard one no source can price -
/// both cases fall through to the ordinary land `mobility` question, because neither is a reason to
/// invent a number. `Err` only for a fleet that *can* be priced but that the game will refuse to
/// move: too heavy, or short of crew.
fn sail_mode(
    ruleset: &Ruleset,
    unit: &ReportUnit,
    origin_hex: &KnownHex,
) -> Result<Option<Sailing>, RouteProblem> {
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
    // Only the owner sets a fleet's course, so a passenger has nothing to plan (`ah-ofra`). Raised
    // after `fleet_sailing` has priced the hull, never before: `fleet_of` uses the syntactic
    // `hulls_named_in`, which reads `Fort` as a hull, and it is `fleet_sailing` answering `None`
    // that sends a unit in a fort down the land path. `reported_owner` and not `fleet_owner`
    // because the planner is handed no orders document at all (the `ah-ssd` decision above), so
    // the report's own listing is the whole of what it can know.
    //
    // Tested before the weight and the crew below, deliberately: which unit may give the order at
    // all is a more basic refusal than what the hull carries or how many sailors are aboard, and
    // neither figure is worth naming to a unit that cannot give the order.
    if let Some(owner) =
        crate::movement::fleet::reported_owner(&origin_hex.units, &fleet.structure_id)
    {
        if owner.unit_id != unit.unit_id {
            return Err(RouteProblem::NotFleetOwner {
                unit: format!("{} ({})", unit.name, unit.unit_id),
                fleet: crate::movement::mode::fleet_label(fleet),
                owner: format!("{} ({})", owner.name, owner.unit_id),
            });
        }
    }

    let short = (available < required).then_some(CrewShortfall {
        required,
        available,
    });

    // Weight before crew, and it absorbs the crew: a player told to unload would otherwise shift
    // cargo, re-plan, and meet a second refusal nobody mentioned. A crew-only shortfall keeps its
    // own refusal below.
    let load_unchecked = match (
        fleet_load(fleet, &origin_hex.units),
        cargo_capacity(fleet, Some(ruleset)),
    ) {
        (Some(load), Some(capacity)) => {
            // Strictly greater: the rule is "does not exceed", so 150 aboard on 150 sails.
            if load > capacity {
                return Err(RouteProblem::FleetOverloaded {
                    load,
                    capacity,
                    crew: short,
                });
            }
            false
        }
        _ => true,
    };

    if let Some(crew) = short {
        return Err(RouteProblem::CrewCannotSail {
            required: crew.required,
            available: crew.available,
        });
    }

    Ok(Some(Sailing {
        points_per_month: speed,
        hull: Hull::from_flies(fleet_flies(fleet, Some(ruleset))),
        load_unchecked,
    }))
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
    journey: Journey,
    coordinate: Coordinate,
    terrain: &str,
) -> bool {
    if journey.mode == MovementMode::Sail {
        if ruleset.is_water(terrain) {
            return false;
        }
        // A flying hull is not bound by the water, so land refuses it nothing - neither an inland
        // hex nor a coastal one. `data/BALL`: "This is a flying 'ship' ...".
        if journey.hull == Hull::Unbound {
            return false;
        }
        return ruleset.sailing_land_needs_coast() && !is_coastal(ruleset, map, coordinate);
    }
    water_verdict(ruleset, map, journey, coordinate, terrain) != WaterVerdict::Passable
}

/// Whether the sailing rule's "one end of every step must be ocean" is being enforced.
///
/// `Enforced` is the game's rule and what every route a player is offered is planned under.
/// `Lifted` exists only for [`blocked_by_sailing_rule`]'s probe: a route that appears only when
/// the rule is lifted is a route that rule is what stopped, and the first land-to-land step on it
/// is the one worth naming. The same trick [`blocked_by_water`] plays with `MovementMode::Fly`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SailRule {
    Enforced,
    Lifted,
}

/// Whether the fleet under a journey is bound by the water.
///
/// A fleet is ordinarily bound: `rules/movement_sailing` gives it only the three ocean-touching
/// steps, and [`blocks`] refuses it any land hex that is not coastal. A flying hull is bound by
/// none of that - `data/BALL`, "This is a flying 'ship' with a capacity of 100 and a speed of 4
/// hexes per month" - so land refuses it nothing.
///
/// Meaningless for every mode but [`MovementMode::Sail`], where it is [`Hull::Bound`] and inert.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Hull {
    /// Bound by the water: the sailing rule applies in full.
    Bound,
    /// Not bound by the water: land refuses it nothing.
    Unbound,
}

impl Hull {
    /// Reads [`crate::movement::mode::fleet_flies`], which is the one reading of the question.
    ///
    /// `Some(false)` - every hull found in the catalogue and none of them flying - is the **only**
    /// answer that binds a fleet to the water. `Some(true)` frees it, and so does `None`, which
    /// means "cannot say": no ruleset, a kind naming no hull, or a hull the catalogue does not
    /// carry. That is deliberately the same reading the `sail-between-land-hexes` warning takes of
    /// the same function, and it is what makes the map and Problems agree about every fleet rather
    /// than about most of them. The navigator chose it on 2026-09-09.
    pub(crate) fn from_flies(flies: Option<bool>) -> Self {
        if flies == Some(false) {
            Self::Bound
        } else {
            Self::Unbound
        }
    }
}

/// How a journey is being made, as far as the search needs to know: the mode, the hull under it,
/// and whether the sailing rule is being enforced for it.
///
/// One value rather than two parameters because [`step_into`] already carries seven arguments and
/// the gate denies `clippy::too_many_arguments`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Journey {
    pub(crate) mode: MovementMode,
    pub(crate) hull: Hull,
    pub(crate) sail_rule: SailRule,
    /// What the traveller may do in the water. [`Swim::Cannot`] for a hypothetical traveller and
    /// for the probes, which is what every caller but `plan_route` and `trace_move` is.
    pub(crate) swim: Swim,
}

impl Journey {
    /// This mode and hull, under the game's own sailing rule - every journey but the probe.
    ///
    /// Swimming defaults to [`Swim::Cannot`], which is what a hypothetical traveller and the
    /// probes are: only a journey made by a unit whose inventory can be read gains an ability, via
    /// [`Journey::with_swim`].
    pub(crate) fn enforced(mode: MovementMode, hull: Hull) -> Self {
        Self {
            mode,
            hull,
            sail_rule: SailRule::Enforced,
            swim: Swim::Cannot,
        }
    }

    /// The same journey, made by something that can swim this well.
    pub(crate) fn with_swim(self, swim: Swim) -> Self {
        Self { swim, ..self }
    }
}

/// How deep a water hex is, as far as the reports can say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Depth {
    /// At least one hex the reports place beside it is dry land, which is what makes it coastal.
    Coastal,
    /// All six directions are hexes the reports know, and every one of them is water.
    Deep,
    /// Some direction is unaccounted for, so nothing can be said. The ordinary state of open sea.
    Unknown,
}

/// Whether this water hex is coastal, deep, or beyond telling.
///
/// Deep demands all six directions because a missing one may be the shore: refusing to guess is
/// the whole of the agreed behaviour here, and the cost of the strict test is an `Unknown` where a
/// player might have said "obviously deep", which is a refusal either way for a swimmer with no
/// sea creatures.
fn water_depth(ruleset: &Ruleset, map: &MapKnowledge, coordinate: Coordinate) -> Depth {
    let mut directions = std::collections::BTreeSet::new();
    for (direction, neighbour) in map.adjacent(coordinate) {
        let Some(hex) = map.hex(neighbour) else {
            continue;
        };
        if !ruleset.is_water(&hex.terrain) {
            return Depth::Coastal;
        }
        directions.insert(direction as u8);
    }
    if directions.len() == 6 {
        Depth::Deep
    } else {
        Depth::Unknown
    }
}

/// Why water refuses this unit here, or that it does not.
///
/// One function rather than a condition per refusal site: the search, the two endpoint guards, the
/// mid-route probe and the order tracer all ask the same question, and three of them have already
/// been wrong about it separately.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WaterVerdict {
    Passable,
    /// It cannot swim at all: today's answer, and today's sentence.
    NeedsShip,
    CannotSwimLoaded {
        capacity: i64,
        load: i64,
    },
    /// Deep water. `borne` is what its sea creatures can bear, and is zero when it has none.
    DeepWater {
        borne: i64,
        load: i64,
    },
    DepthUnknown,
    SwimCapacityUnstated,
}

/// What the water at `coordinate` does to this journey.
pub(crate) fn water_verdict(
    ruleset: &Ruleset,
    map: &MapKnowledge,
    journey: Journey,
    coordinate: Coordinate,
    terrain: &str,
) -> WaterVerdict {
    if !ruleset.is_water(terrain) || !ruleset.water_needs_a_ship() || flies(journey.mode) {
        return WaterVerdict::Passable;
    }
    let (borne, load) = match journey.swim {
        Swim::Cannot => return WaterVerdict::NeedsShip,
        Swim::Unstated => return WaterVerdict::SwimCapacityUnstated,
        Swim::Overloaded { capacity, load } => {
            return WaterVerdict::CannotSwimLoaded { capacity, load }
        }
        Swim::Anywhere => return WaterVerdict::Passable,
        Swim::Coastal { borne, load } => (borne, load),
    };
    // Defensive: a world with no swimming rule cannot have produced anything but `Cannot` above.
    let Some(rule) = ruleset.swimming() else {
        return WaterVerdict::NeedsShip;
    };
    if rule
        .unrestricted
        .iter()
        .any(|name| name.eq_ignore_ascii_case(terrain))
        || !rule.deep_needs_sea_creatures
    {
        return WaterVerdict::Passable;
    }
    match water_depth(ruleset, map, coordinate) {
        Depth::Coastal => WaterVerdict::Passable,
        Depth::Deep => WaterVerdict::DeepWater { borne, load },
        Depth::Unknown => WaterVerdict::DepthUnknown,
    }
}

/// The refusal the water at `coordinate` is for this journey, or `None` where it is no obstacle.
///
/// The one way a refusal site may ask: it goes through [`blocks`], so a caller can never reach
/// [`water_verdict`] by a route [`blocks`] would have short-circuited - a `Sail` journey, whose
/// water question the sailing rule answers first and whose refusals are not about swimming at all.
/// Three sites have been separately wrong about water; this is what stops there being a fourth.
fn water_refusal(
    ruleset: &Ruleset,
    map: &MapKnowledge,
    journey: Journey,
    coordinate: Coordinate,
    terrain: &str,
    destination: bool,
) -> Option<RouteProblem> {
    if !blocks(ruleset, map, journey, coordinate, terrain) {
        return None;
    }
    let verdict = water_verdict(ruleset, map, journey, coordinate, terrain);
    water_problem(verdict, coordinate, terrain.to_string(), destination)
}

/// The refusal this verdict is, or `None` where the water is no obstacle.
fn water_problem(
    verdict: WaterVerdict,
    coordinate: Coordinate,
    terrain: String,
    destination: bool,
) -> Option<RouteProblem> {
    Some(match verdict {
        WaterVerdict::Passable => return None,
        WaterVerdict::NeedsShip => {
            if destination {
                RouteProblem::DestinationNeedsShip {
                    coordinate,
                    terrain,
                }
            } else {
                RouteProblem::OceanNeedsShip {
                    coordinate,
                    terrain,
                }
            }
        }
        WaterVerdict::CannotSwimLoaded { capacity, load } => RouteProblem::SwimLoadTooHeavy {
            coordinate,
            terrain,
            capacity,
            load,
            destination,
        },
        WaterVerdict::DeepWater { borne, load } => RouteProblem::DeepWaterNeedsSeaCreatures {
            coordinate,
            terrain,
            borne,
            load,
            destination,
        },
        WaterVerdict::DepthUnknown => RouteProblem::WaterDepthUnknown {
            coordinate,
            terrain,
        },
        WaterVerdict::SwimCapacityUnstated => RouteProblem::SwimCapacityUnstated {
            coordinate,
            terrain,
        },
    })
}

/// Whether the sailing rule refuses this step outright, whatever the two hexes are like on their
/// own.
///
/// `rules/movement_sailing`: "A fleet can move from an ocean region to another ocean region, or
/// from a coastal region to an ocean region, or from an ocean region to a coastal region." All
/// three have ocean at one end, so a step with land at both ends is none of them - even where both
/// hexes are coastal and [`blocks`] is therefore content with each of them separately.
///
/// Gated on the ruleset's own `land_needs_coast`, the flag that says this world models the sailing
/// restriction at all. A ruleset that does not is not to be overruled by a belief hardcoded here.
pub(crate) fn refused_by_sailing_step(
    ruleset: &Ruleset,
    journey: Journey,
    from_terrain: &str,
    into_terrain: &str,
) -> bool {
    journey.mode == MovementMode::Sail
        && journey.hull == Hull::Bound
        && ruleset.sailing_land_needs_coast()
        && !ruleset.is_water(from_terrain)
        && !ruleset.is_water(into_terrain)
}

/// Whether a hex has at least one neighbour the map itself describes as water.
fn is_coastal(ruleset: &Ruleset, map: &MapKnowledge, coordinate: Coordinate) -> bool {
    map.neighbours(coordinate).any(|(_, neighbour)| {
        map.hex(neighbour)
            .is_some_and(|hex| ruleset.is_water(&hex.terrain))
    })
}

/// Whether the side a fleet entered this terrain by decides where it may go next.
///
/// The one gate, read by both the search's state and [`leaving_land`], so the state the search
/// carries and the rule it applies can never disagree. False for every mode but `Sail`, for a
/// flying hull, for water, for a world whose ruleset does not state the restriction, and under the
/// probe's `SailRule::Lifted` - so every other search is the same Dijkstra over the same states it
/// has always been.
pub(crate) fn constrains_departure(ruleset: &Ruleset, journey: Journey, terrain: &str) -> bool {
    journey.mode == MovementMode::Sail
        && journey.hull == Hull::Bound
        && journey.sail_rule == SailRule::Enforced
        && ruleset.sailing_side_restricted()
        && !ruleset.is_water(terrain)
}

/// A canal that actually works here: the building's own name, and what a pass through it costs.
///
/// `newage/trident rules/economy_canals`: "A canal built in a region that touches no water has no
/// effect on ship movement", which is what the `is_coastal` guard is.
///
/// It has no test of its own, because no *planned* route reaches it: `blocks` already refuses a
/// bound fleet every non-coastal land hex, under the `sailing_land_needs_coast` flag the scraper
/// hardcodes true for every world the application can load. The order tracer is the exception - it
/// draws an order as written, not as permitted, and gates on no such thing - so a traced order
/// through a land-locked canal region does reach here. The answer is still right and still
/// invisible: `blocks` has already set that hex's `blocked_from`, and `Isthmus::Refused` only
/// withholds a premium on a step nothing displays. Kept because it is the rule's own sentence and
/// costs nothing. Read from
/// `structures_ever_seen` rather than `structures` because a canal cannot fall down or sail away.
/// Where both grades stand in one region the cheaper wins - a fleet would use the faster canal -
/// with the name breaking a tie so the answer never depends on report order.
pub(crate) fn canal_here(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    coordinate: Coordinate,
) -> Option<(String, u32)> {
    if !is_coastal(ruleset, map, coordinate) {
        return None;
    }
    map.hex(coordinate)?
        .structures_ever_seen
        .iter()
        .filter_map(|standing| {
            ruleset
                .canal_cost(&standing.base_kind)
                .map(|cost| (standing.base_kind.clone(), cost))
        })
        .min_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)))
}

/// What the side restriction makes of leaving a land hex by one particular side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Isthmus {
    /// The rule does not bite, or the side is one of the three it allows.
    Free,
    /// Only a canal permits it. `cost` is what the pass costs in total, where an ordinary sailing
    /// step costs [`Ruleset::sailing_flat_cost`].
    ThroughCanal { name: String, cost: u32 },
    /// The game refuses the step.
    Refused,
}

/// Whether a fleet standing in `here` may leave it travelling `leaving_by`, having arrived
/// travelling `entered_by`.
///
/// `entered_by` is `None` for the hex a journey starts in, and that is the rule's other half:
/// "Ships ending their movement in a land hex may sail out along any side connecting to water."
/// A fleet's origin is where last month left it, so its first step is always a departure and never
/// a through-pass.
pub(crate) fn leaving_land(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Journey,
    here: Coordinate,
    here_terrain: &str,
    entered_by: Option<Direction>,
    leaving_by: Direction,
) -> Isthmus {
    if !constrains_departure(ruleset, journey, here_terrain) {
        return Isthmus::Free;
    }
    let Some(entered) = entered_by else {
        return Isthmus::Free;
    };
    if may_leave_land(entered, leaving_by) {
        return Isthmus::Free;
    }
    match canal_here(map, ruleset, here) {
        Some((name, cost)) => Isthmus::ThroughCanal { name, cost },
        None => Isthmus::Refused,
    }
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
    journey: Journey,
    origin: Coordinate,
    destination: Coordinate,
) -> Option<RouteProblem> {
    // A fleet already crosses water freely, so the "what if it could swim" probe answers a
    // question Sail does not have.
    if flies(journey.mode) || journey.mode == MovementMode::Sail {
        return None;
    }

    let swimming = cheapest_path(
        map,
        ruleset,
        Journey::enforced(MovementMode::Fly, Hull::Bound),
        origin,
        destination,
    )
    .ok()?
    .0;
    // Asked with the real journey, never the probe's: the probe flies, and a flier is refused
    // nothing by water.
    swimming.iter().find_map(|step| {
        let hex = map.hex(step.to)?;
        water_refusal(
            ruleset,
            map,
            journey,
            step.to,
            &hex.terrain,
            step.to == destination,
        )
    })
}

/// Whether the sailing rule is the only thing standing between the fleet and its destination.
///
/// Re-runs the search with that rule lifted. A route that appears only under the relaxation means
/// the rule is the obstacle, so the refusal can name the step the fleet would be refused at rather
/// than shrugging - and "nothing joins those two hexes up" reads plainly wrong to a player looking
/// at two hexes side by side that the faction has both seen.
///
/// Returns `None` for anything but a fleet, and for a fleet whose journey the relaxation does not
/// rescue: then something else is in the way and [`RouteProblem::NoKnownRoute`] is the honest
/// answer.
fn blocked_by_sailing_rule(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Journey,
    origin: Coordinate,
    destination: Coordinate,
) -> Option<RouteProblem> {
    if journey.mode != MovementMode::Sail {
        return None;
    }

    let relaxed = cheapest_path(
        map,
        ruleset,
        Journey {
            sail_rule: SailRule::Lifted,
            ..journey
        },
        origin,
        destination,
    )
    .ok()?
    .0;

    // Walk it and name the first step the rule refuses. The origin's terrain comes from the map;
    // every later step carries the terrain it landed in.
    let mut from = origin;
    let mut from_terrain = map.hex(origin)?.terrain.clone();
    let mut entered_by: Option<Direction> = None;
    for step in &relaxed {
        // The land-to-land rule is asked first on purpose: a step with land at both ends is refused
        // whatever the sides, so that is the sentence worth showing.
        if refused_by_sailing_step(ruleset, journey, &from_terrain, &step.terrain) {
            return Some(RouteProblem::SailNeedsOcean {
                from,
                from_terrain,
                to: step.to,
                to_terrain: step.terrain.clone(),
            });
        }
        if leaving_land(
            map,
            ruleset,
            journey,
            from,
            &from_terrain,
            entered_by,
            step.direction,
        ) == Isthmus::Refused
        {
            return Some(RouteProblem::IsthmusNeedsCanal {
                coordinate: from,
                terrain: from_terrain,
            });
        }
        entered_by =
            constrains_departure(ruleset, journey, &step.terrain).then_some(step.direction);
        from = step.to;
        from_terrain = step.terrain.clone();
    }
    None
}

/// Moves each through-pass premium from the edge that left the canal region onto the step that
/// entered it, which is where the agreed display puts it: `plain (2,2) · 2 · Canal`, then
/// `ocean (3,3) · 1`.
///
/// Changes no total and no month, both of which were settled from the search's own costs. `index`
/// is never 0: the origin's entry side is `None`, so a journey's first step can never be a
/// through-pass.
fn shift_canal_premiums(steps: &mut [RouteStep], mut passes: Vec<Option<CanalPass>>) {
    for index in 1..steps.len() {
        if let Some(pass) = passes[index].take() {
            steps[index].cost -= pass.premium;
            steps[index - 1].cost += pass.premium;
            steps[index - 1].canal = Some(pass.name);
        }
    }
}

/// What entering `into` costs from `from`, or `None` when the unit may not go there at all.
///
/// Shared with the order tracer, which uses the refusal as its cue to guess instead.
pub(crate) fn step_cost(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Journey,
    from: Coordinate,
    direction: Direction,
    into: Coordinate,
) -> Option<(u32, bool)> {
    // An undescribed hex has no terrain, so a step into it would cost whatever we invented.
    let hex = map.hex(into)?;

    if blocks(ruleset, map, journey, into, &hex.terrain) {
        return None;
    }

    // A fleet's flat cost is the sailing rule itself, not the terrain premium, and no road ever
    // applies to it - roads help feet and hooves, not hulls.
    if journey.mode == MovementMode::Sail {
        return Some((ruleset.sailing_flat_cost(), false));
    }

    let base = ruleset.terrain_cost(&hex.terrain, journey.mode);
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
///
/// The third component is the side a fleet came in by where that decides where it may go next. It
/// is `Some` only where [`constrains_departure`] is true - a bound fleet in a land hex under a
/// world that states the restriction - so a walker's search, a flier's, and every search in a
/// ruleset that does not state the rule keep exactly the states they had.
type Standing = (String, String, Option<Direction>);

/// A through-pass a canal permitted: the building's own name, and the points the pass costs beyond
/// an ordinary sailing step. Search bookkeeping, never on the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CanalPass {
    name: String,
    premium: u32,
}

/// Where the search stands before a step. One value rather than two arguments because [`step_into`]
/// already carries the seven the gate's `clippy::too_many_arguments` allows.
#[derive(Debug, Clone, Copy)]
struct Arrival<'a> {
    terrain: &'a str,
    entered_by: Option<Direction>,
}

/// Dijkstra over the known hexes, and over the fog around them.
fn cheapest_path(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Journey,
    origin: Coordinate,
    destination: Coordinate,
) -> Result<(Vec<RouteStep>, Vec<Option<CanalPass>>), RouteProblem> {
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
    let mut came_from: BTreeMap<Standing, (Standing, RouteStep, Option<CanalPass>)> =
        BTreeMap::new();
    // Where each hex the search has reached actually is. A hex the map has never heard of cannot be
    // looked up, so the search remembers the coordinate it arrived at.
    let mut position: BTreeMap<String, Coordinate> = BTreeMap::new();

    // `None`: a fleet's origin is where last month left it, so its first step is a departure.
    let start: Standing = (origin.id(), origin_terrain, None);
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
            let Some(step) = step_into(
                map,
                ruleset,
                journey,
                here,
                Arrival {
                    terrain: &standing.1,
                    entered_by: standing.2,
                },
                direction,
                neighbour,
            ) else {
                continue;
            };
            let total: Price = (price.0 + usize::from(step.estimated), price.1 + step.cost);
            let entered_by =
                constrains_departure(ruleset, journey, &step.terrain).then_some(direction);
            let reached: Standing = (neighbour.id(), step.terrain.clone(), entered_by);
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
                        over_water: !step.estimated && ruleset.is_water(&step.terrain),
                        terrain: step.terrain,
                        cost: step.cost,
                        road: step.road,
                        estimated: step.estimated,
                        canal: None,
                    },
                    step.canal,
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
    /// The through-pass this step's *departure* paid for, where a canal permitted a side the rule
    /// would otherwise refuse.
    canal: Option<CanalPass>,
}

/// Entering a hex, described or not.
///
/// A described hex is costed by [`step_cost`], which also refuses the ones the unit may not enter.
/// An unexplored one is taken for the terrain behind it, and marked so nobody mistakes the number
/// for a fact.
fn step_into(
    map: &MapKnowledge,
    ruleset: &Ruleset,
    journey: Journey,
    from: Coordinate,
    arrival: Arrival<'_>,
    direction: Direction,
    into: Coordinate,
) -> Option<Step> {
    let Journey {
        mode,
        hull: _,
        sail_rule,
        swim: _,
    } = journey;
    let carried = arrival.terrain;
    if let Some(hex) = map.hex(into) {
        let (mut cost, road) = step_cost(map, ruleset, journey, from, direction, into)?;
        if sail_rule == SailRule::Enforced
            && refused_by_sailing_step(ruleset, journey, carried, &hex.terrain)
        {
            return None;
        }
        // The rules price the *pass*, not the entry: "the through-pass costs two movement points
        // where ordinary sailing costs one." So the premium is charged on the edge that leaves the
        // canal region, which is also the only place the search can know a pass is happening.
        let mut canal = None;
        match leaving_land(
            map,
            ruleset,
            journey,
            from,
            carried,
            arrival.entered_by,
            direction,
        ) {
            Isthmus::Free => {}
            Isthmus::Refused => return None,
            Isthmus::ThroughCanal { name, cost: pass } => {
                // `saturating_sub` because a Mystic Canal's 1 equals the flat cost: the premium is
                // zero and the name is still carried.
                let premium = pass.saturating_sub(ruleset.sailing_flat_cost());
                cost += premium;
                canal = Some(CanalPass { name, premium });
            }
        }
        return Some(Step {
            cost,
            road,
            terrain: hex.terrain.clone(),
            estimated: false,
            canal,
        });
    }

    // A route that is already at sea - a unit aboard a fleet - would be guessing itself further out
    // to sea, and the sea is exactly what a walker may not cross. For a fleet the same guard asks
    // the opposite question: fog beyond the described map cannot be confirmed coastal, so a land
    // guess blocks it rather than assuming a way in.
    if blocks(ruleset, map, journey, into, carried)
        || (sail_rule == SailRule::Enforced
            && refused_by_sailing_step(ruleset, journey, carried, carried))
    {
        return None;
    }
    // No isthmus arm is needed here: a fleet can never stand in a land fog hex, because
    // `refused_by_sailing_step(ruleset, journey, carried, carried)` just refused it there, and a
    // water hex is `Isthmus::Free`.
    Some(Step {
        cost: base_terrain_cost(ruleset, mode, carried),
        road: false,
        terrain: carried.to_string(),
        estimated: true,
        canal: None,
    })
}

/// Rebuilds the path, keeping each through-pass premium where the search charged it. Moving it
/// onto the step the player sees is [`route_for_mode`]'s job, and happens after the months are
/// split from these costs.
fn rebuild(
    came_from: &BTreeMap<Standing, (Standing, RouteStep, Option<CanalPass>)>,
    start: &Standing,
    arrival: &Standing,
) -> (Vec<RouteStep>, Vec<Option<CanalPass>>) {
    let mut steps = Vec::new();
    let mut passes = Vec::new();
    let mut cursor = arrival.clone();

    while cursor != *start {
        let Some((previous, step, pass)) = came_from.get(&cursor) else {
            break;
        };
        steps.push(step.clone());
        passes.push(pass.clone());
        cursor = previous.clone();
    }

    steps.reverse();
    passes.reverse();
    (steps, passes)
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
                Journey::enforced(MovementMode::Walk, Hull::Bound),
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
                Journey::enforced(MovementMode::Walk, Hull::Bound),
                here,
                Direction::Southeast,
                undescribed
            ),
            None,
            "an undescribed hex must refuse rather than invent a cost"
        );
    }

    /// The three shapes a water hex's depth can be read as. `(2,2)` has a shore, `(3,3)` names six
    /// water neighbours, and `(4,4)` is named by one hex and nothing else - the ordinary state of
    /// open sea, and refused rather than guessed at.
    #[test]
    fn open_sea_with_an_unexplored_neighbour_cannot_be_told() {
        let map = MapKnowledge::from_report(&parse_report_full(SEA_AND_SHORE));
        let ruleset = trident();

        assert_eq!(
            water_depth(&ruleset, &map, Coordinate { x: 2, y: 2, z: 1 }),
            Depth::Coastal
        );
        assert_eq!(
            water_depth(&ruleset, &map, Coordinate { x: 3, y: 3, z: 1 }),
            Depth::Deep
        );
        assert_eq!(
            water_depth(&ruleset, &map, Coordinate { x: 4, y: 4, z: 1 }),
            Depth::Unknown
        );
    }

    /// `Swim::Unstated` cannot be reached through a report - `parse_capacities` refuses anything
    /// but four numbers - so the verdict is asked directly. A dry route is unaffected by it.
    #[test]
    fn a_dry_route_is_unaffected_by_an_unstated_swim_capacity() {
        let map = MapKnowledge::from_report(&parse_report_full(SEA_AND_SHORE));
        let ruleset = trident();
        let journey = Journey::enforced(MovementMode::Walk, Hull::Bound)
            .with_swim(crate::movement::mode::Swim::Unstated);

        assert_eq!(
            water_verdict(
                &ruleset,
                &map,
                journey,
                Coordinate { x: 2, y: 2, z: 1 },
                "ocean"
            ),
            WaterVerdict::SwimCapacityUnstated
        );
        assert!(
            !blocks(
                &ruleset,
                &map,
                journey,
                Coordinate { x: 1, y: 1, z: 1 },
                "plain"
            ),
            "dry land refuses nobody for want of a swimming capacity"
        );
    }

    /// The variant no report can reach - `parse_capacities` refuses anything but four numbers -
    /// so the mapping from verdict to refusal is pinned directly. It carries no `destination` flag:
    /// the agreed sentence is the same whichever hex it is.
    #[test]
    fn an_unstated_swim_capacity_refuses_the_hex_by_name() {
        let coordinate = Coordinate { x: 2, y: 2, z: 1 };
        for destination in [false, true] {
            assert_eq!(
                water_problem(
                    WaterVerdict::SwimCapacityUnstated,
                    coordinate,
                    "ocean".to_string(),
                    destination
                ),
                Some(RouteProblem::SwimCapacityUnstated {
                    coordinate,
                    terrain: "ocean".to_string(),
                })
            );
        }
    }

    fn trident() -> Ruleset {
        Ruleset::from_json(atlantis_hud_fixtures::NEWAGE_TRIDENT_RULESET_JSON)
            .expect("the committed Trident ruleset loads")
    }

    /// A shore, the coastal water beside it, a deep hex whose six neighbours are all water, and a
    /// hex of open water named by one report line alone.
    const SEA_AND_SHORE: &str = "Foo (1) Report\n\n\
         plain (1,1) in Nowhere, 10 peasants (orcs), $5.\n\n\
         Exits:\n  Southeast : ocean (2,2) in Atlantis Ocean.\n\n\
         ocean (2,2) in Atlantis Ocean.\n\n\
         Exits:\n  \
         Northwest : plain (1,1) in Nowhere.\n  \
         North : ocean (2,0) in Atlantis Ocean.\n  \
         Northeast : ocean (3,1) in Atlantis Ocean.\n  \
         Southeast : ocean (3,3) in Atlantis Ocean.\n  \
         South : ocean (2,4) in Atlantis Ocean.\n  \
         Southwest : ocean (1,3) in Atlantis Ocean.\n\n\
         ocean (3,3) in Atlantis Ocean.\n\n\
         Exits:\n  \
         North : ocean (3,1) in Atlantis Ocean.\n  \
         Northeast : ocean (4,2) in Atlantis Ocean.\n  \
         Southeast : ocean (4,4) in Atlantis Ocean.\n  \
         South : ocean (3,5) in Atlantis Ocean.\n  \
         Southwest : ocean (2,4) in Atlantis Ocean.\n  \
         Northwest : ocean (2,2) in Atlantis Ocean.\n";
}
