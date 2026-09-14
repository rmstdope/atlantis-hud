//! A MOVE that would cross a wall a report proves (`ah-wq2e.4`).
//!
//! Worked out where the remembered map is read, from the movement trace's own answer
//! ([`TracedPath::wall`](crate::movement::trace::TracedPath::wall)), so the Problems warning and the
//! map's red bar always name the same step.

use std::collections::BTreeMap;

use crate::known_map::KnownMap;
use crate::movement::fleet::OrderedUnits;
use crate::movement::graph::{Direction, MapKnowledge};
use crate::movement::rules::Ruleset;
use crate::report::model::Coordinate;
use crate::report::ParsedReport;

/// A unit whose own chained MOVE/ADVANCE route crosses a wall a report proves, at its first such
/// step. Built from the movement trace's own answer, so the warning and the map's red bar name
/// the same step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalledMove {
    /// Which directional step is blocked: the 0-based index among the `MoveStep::Go` entries of
    /// the unit's chained route, counted across every MOVE line of the block.
    pub go_step: usize,
    /// The hex the blocked step would have left.
    pub from: Coordinate,
    /// The side of that hex the step would have crossed.
    pub direction: Direction,
    /// What the warning calls `from`: the settlement's name when the hex has one, otherwise
    /// its terrain in lower case.
    pub place: String,
}

/// Keyed by the report's unit number. Empty is "nothing known", the default.
pub type WalledMoves = BTreeMap<String, WalledMove>;

/// The warning sentence, exactly as agreed.
#[must_use]
pub fn message(walled: &WalledMove) -> String {
    format!(
        "There is no exit {} from {} ({},{},{}): a report shows a wall on that side.",
        walled.direction.label(),
        walled.place,
        walled.from.x,
        walled.from.y,
        walled.from.z
    )
}

/// Every own unit's first walled step, from a map already built.
pub(crate) fn walled_moves_on(
    report: &ParsedReport,
    ruleset: &Ruleset,
    known: &KnownMap,
    map: &MapKnowledge,
    ordered: &OrderedUnits,
) -> WalledMoves {
    let mut walled = WalledMoves::new();
    for unit in report
        .regions
        .iter()
        .flat_map(|region| region.units.iter())
        .filter(|unit| unit.own)
    {
        let Some(route) = ordered.route_of(&unit.unit_id) else {
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
        let Some(wall) = path.wall else {
            continue;
        };
        // The walk places one step per directional step it takes and stops before the walled one,
        // so the steps placed are exactly the directional steps before it - on both sides of a
        // followed passage.
        let go_step = path.steps.len()
            + path
                .passage
                .as_ref()
                .and_then(|passage| passage.exit.as_ref())
                .map_or(0, |exit| exit.steps.len());
        walled.insert(
            unit.unit_id.clone(),
            WalledMove {
                go_step,
                from: wall.coordinate,
                direction: wall.direction,
                place: place_of(known, map, wall.coordinate),
            },
        );
    }
    walled
}

/// The settlement's name where the hex has one, otherwise its terrain in lower case.
fn place_of(known: &KnownMap, map: &MapKnowledge, coordinate: Coordinate) -> String {
    match known.hexes.iter().find(|hex| hex.coordinate == coordinate) {
        Some(hex) => hex.settlement.as_ref().map_or_else(
            || hex.terrain.to_lowercase(),
            |settlement| settlement.name.clone(),
        ),
        None => map
            .hex(coordinate)
            .map_or_else(|| "unknown".to_string(), |hex| hex.terrain.to_lowercase()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_warning_is_the_agreed_sentence() {
        assert_eq!(
            message(&WalledMove {
                go_step: 0,
                from: Coordinate { x: 9, y: 3, z: 2 },
                direction: Direction::North,
                place: "Ciestucshire".into(),
            }),
            "There is no exit North from Ciestucshire (9,3,2): a report shows a wall on that side."
        );
        assert_eq!(
            message(&WalledMove {
                go_step: 0,
                from: Coordinate { x: 7, y: 3, z: 2 },
                direction: Direction::Southwest,
                place: "cavern".into(),
            }),
            "There is no exit Southwest from cavern (7,3,2): a report shows a wall on that side."
        );
    }
}
