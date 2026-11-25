//! A MOVE that would walk a unit onto water it needs a ship for (`ah-cwyyq`), or leave a flier
//! over water when its month runs out (`ah-lxq6w`).
//!
//! `rules/move`: "A move can fail because the unit runs out of movement points, because the unit
//! attempts to move into the ocean, or because the unit attempts to enter a structure, and is
//! rejected." Worked out where the remembered map is read, from the movement trace's own answer
//! ([`TracedPath::blocked_from`](crate::movement::trace::TracedPath::blocked_from)), and judged by
//! the planner's own water rule, so the Problems warning and the Plan move panel refuse the same
//! step in the same words.

use std::collections::BTreeMap;

use crate::movement::fleet::OrderedUnits;
use crate::movement::graph::MapKnowledge;
use crate::movement::mode::swim_ability;
use crate::movement::orders::MoveStep;
use crate::movement::plan::{water_verdict, Hull, Journey, WaterVerdict};
use crate::movement::rules::{MovementMode, Ruleset};
use crate::orders::blocks::OrderedUnitKey;
use crate::report::model::Coordinate;
use crate::report::ParsedReport;

/// A unit whose own chained MOVE/ADVANCE route steps onto water it would need a ship for, at the
/// first such step, or a flier whose month runs out over water, at the step it ends on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WateredMove {
    /// Which directional step is refused: the 0-based index among the `MoveStep::Go` entries of
    /// the unit's chained route, counted across every MOVE line of the block.
    pub go_step: usize,
    /// The water hex the step would enter.
    pub coordinate: Coordinate,
    /// Its terrain, as the map names it.
    pub terrain: String,
    /// Whether the route ends there, which is what decides between "would need a ship to be there"
    /// and "is in the way". Always `false` for a drowning, which has one sentence.
    pub destination: bool,
    /// A flier whose month runs out over this hex, rather than a unit that needs a ship to enter
    /// it (`ah-lxq6w`, `rules/tableitemweights`: "flying units must end their movement on land or
    /// else drown").
    pub drowns: bool,
}

/// Keyed by the report's unit number. Empty is "nothing known", the default.
pub type WateredMoves = BTreeMap<String, WateredMove>;

/// The warning sentence: the Plan move panel's own refusal for the same step
/// (`PlannerPanel.tsx`, `destinationNeedsShip` and `oceanNeedsShip`).
#[must_use]
pub fn message(watered: &WateredMove) -> String {
    let word = watered.terrain.to_lowercase();
    let (x, y) = (watered.coordinate.x, watered.coordinate.y);
    if watered.drowns {
        // `flightWouldEndOverOcean`, with the panel's `definiteWater`.
        let definite = if word == "ocean" {
            "the sea".to_string()
        } else {
            format!("the {word}")
        };
        format!(
            "A single MOVE order would leave this unit over {definite} at ({x},{y}) when the \
             month ran out, and a unit that ends a turn over water drowns."
        )
    } else if watered.destination {
        let indefinite = if word == "ocean" {
            word
        } else {
            format!("a {word}")
        };
        format!("({x},{y}) is {indefinite}, and this unit would need a ship to be there.")
    } else {
        let definite = if word == "ocean" {
            "The sea".to_string()
        } else {
            format!("The {word}")
        };
        format!("{definite} at ({x},{y}) is in the way, and crossing it needs a ship.")
    }
}

/// Every own unit's first step onto water it cannot enter without a ship, or a flier's first
/// month that runs out over water.
///
/// Only the plain refusal is warned about. Left alone here: a step the planner calls doubtful
/// (depth unknown, swim capacity unstated) or refuses for a load or deep water; water past an `IN`
/// passage, since the trace's `steps` hold only the steps before it.
///
/// A flier is warned instead when one of its months runs out over water, as the planner refuses
/// the same route (`RouteProblem::FlightWouldEndOverOcean`): it drowns (`rules/tableitemweights`).
pub(crate) fn watered_moves_on(
    report: &ParsedReport,
    ruleset: &Ruleset,
    map: &MapKnowledge,
    ordered: &OrderedUnits,
) -> WateredMoves {
    let mut watered = WateredMoves::new();
    for unit in report
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.own)
    {
        let Some(route) = ordered.route(&OrderedUnitKey::shown(&unit.unit_id)) else {
            continue;
        };
        if route.sail {
            continue;
        }
        let Some(path) =
            crate::movement::trace::trace_move(map, ruleset, unit, &route.steps, Some(ordered))
        else {
            continue;
        };
        if path.mode == Some(MovementMode::Fly) && ruleset.flight_must_end_on_land() {
            if let Some(drowned) = drowning(ruleset, map, &path) {
                watered.insert(unit.unit_id.clone(), drowned);
            }
            continue;
        }
        let Some(index) = refused_water_step(ruleset, map, unit, &path) else {
            continue;
        };
        let step = &path.steps[index];
        let go_steps = route
            .steps
            .iter()
            .filter(|step| matches!(step, MoveStep::Go(_)))
            .count();
        watered.insert(
            unit.unit_id.clone(),
            WateredMove {
                go_step: index,
                coordinate: step.to,
                terrain: step.terrain.clone(),
                destination: index + 1 == go_steps,
                drowns: false,
            },
        );
    }
    watered
}

/// The index, among `path`'s steps, of the first step a walker takes onto water it needs a ship
/// for, the step `rules/move` says fails ("A move can fail because ... the unit attempts to move
/// into the ocean"). Nothing for a fleet, for a step whose terrain is guessed, and for a step the
/// planner only doubts or refuses for another reason: those are left alone, as the warning leaves
/// them.
///
/// The one answer to "where does the sea stop this walker", read by the `move-into-water` warning
/// and by the units table's month end (`ah-71z6y`).
pub(crate) fn refused_water_step(
    ruleset: &Ruleset,
    map: &MapKnowledge,
    unit: &crate::report::model::ReportUnit,
    path: &crate::movement::trace::TracedPath,
) -> Option<usize> {
    let (Some(mode), Some(index)) = (path.mode, path.blocked_from) else {
        return None;
    };
    if mode == MovementMode::Sail {
        return None;
    }
    let step = path.steps.get(index)?;
    if step.estimated || !step.over_water {
        return None;
    }
    let journey = Journey::enforced(mode, Hull::Bound).with_swim(swim_ability(unit, ruleset));
    (water_verdict(ruleset, map, journey, step.to, &step.terrain) == WaterVerdict::NeedsShip)
        .then_some(index)
}

/// The first month a flier's route runs out over water, judged as the planner judges it: by the
/// terrain the map knows at the hex the month ends at. A guessed terrain is not judged.
fn drowning(
    ruleset: &Ruleset,
    map: &MapKnowledge,
    path: &crate::movement::trace::TracedPath,
) -> Option<WateredMove> {
    let mut taken = 0;
    for leg in &path.months {
        taken += leg.steps;
        if leg.steps == 0 {
            continue;
        }
        let index = taken - 1;
        let step = path.steps.get(index)?;
        if step.estimated || step.to != leg.ends_at {
            continue;
        }
        let wet = map
            .hex(leg.ends_at)
            .is_some_and(|hex| ruleset.is_water(&hex.terrain));
        if wet {
            return Some(WateredMove {
                go_step: index,
                coordinate: step.to,
                terrain: step.terrain.clone(),
                destination: false,
                drowns: true,
            });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(x: i32, y: i32) -> Coordinate {
        Coordinate { x, y, z: 1 }
    }

    #[test]
    fn the_sentences_are_the_planners() {
        let ocean = WateredMove {
            go_step: 0,
            coordinate: at(38, 42),
            terrain: "Ocean".into(),
            destination: true,
            drowns: false,
        };
        assert_eq!(
            message(&ocean),
            "(38,42) is ocean, and this unit would need a ship to be there."
        );
        assert_eq!(
            message(&WateredMove {
                destination: false,
                ..ocean
            }),
            "The sea at (38,42) is in the way, and crossing it needs a ship."
        );
    }

    #[test]
    fn a_drowning_says_so_in_the_planners_words() {
        let sea = WateredMove {
            go_step: 0,
            coordinate: at(38, 42),
            terrain: "Ocean".into(),
            destination: false,
            drowns: true,
        };
        assert_eq!(
            message(&sea),
            "A single MOVE order would leave this unit over the sea at (38,42) when the month ran \
             out, and a unit that ends a turn over water drowns."
        );
    }
}
