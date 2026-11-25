//! A MOVE that would walk a unit onto water it needs a ship for (`ah-cwyyq`).
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
/// first such step.
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
    /// and "is in the way".
    pub destination: bool,
}

/// Keyed by the report's unit number. Empty is "nothing known", the default.
pub type WateredMoves = BTreeMap<String, WateredMove>;

/// The warning sentence: the Plan move panel's own refusal for the same step
/// (`PlannerPanel.tsx`, `destinationNeedsShip` and `oceanNeedsShip`).
#[must_use]
pub fn message(watered: &WateredMove) -> String {
    let word = watered.terrain.to_lowercase();
    let (x, y) = (watered.coordinate.x, watered.coordinate.y);
    if watered.destination {
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

/// Every own walking unit's first step onto water it cannot enter without a ship.
///
/// Only the plain refusal is warned about. Left alone here: a step the planner calls doubtful
/// (depth unknown, swim capacity unstated) or refuses for a load or deep water; water past an `IN`
/// passage, since the trace's `steps` hold only the steps before it; and a flier ending its move
/// over water, which is a drowning rather than a missing ship.
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
        let (Some(mode), Some(index)) = (path.mode, path.blocked_from) else {
            continue;
        };
        if mode == MovementMode::Sail {
            continue;
        }
        let Some(step) = path.steps.get(index) else {
            continue;
        };
        if step.estimated || !step.over_water {
            continue;
        }
        let journey = Journey::enforced(mode, Hull::Bound).with_swim(swim_ability(unit, ruleset));
        if water_verdict(ruleset, map, journey, step.to, &step.terrain) != WaterVerdict::NeedsShip {
            continue;
        }
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
            },
        );
    }
    watered
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
}
