//! Reads the moves guards stopped out of the turn's event lines (ah-vq8z).
//!
//! Two shapes, both in `Events during turn:` (rules/movement_order: units using MOVE or ADVANCE are
//! kept out of a guarded region, fleets enter it and are then stopped by the guards):
//!
//! ```text
//! Scout (3744): Is forbidden entry to swamp (36,50) in Pangmore by Unit (7235).
//! Ship [235] is stopped by guards in ocean (38,44) in Atlantis Ocean.
//! ```
//!
//! The first may carry the guard's faction after a comma (`by Unit (7235), Some Faction (41).`);
//! it is dropped, because the agreed design always shows the unit number.

use serde::{Deserialize, Serialize};

use super::model::Coordinate;
use super::scan::{parse_coordinate, split_trailing_id};

/// A guard named by a "forbidden entry" line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct BlockingGuard {
    /// The guard's name as printed: `Unit`, `Guardsmen`.
    pub name: String,
    /// The bare unit number: `7235`.
    pub id: String,
}

/// One move the report says guards stopped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct BlockedMove {
    /// The hex the mover was kept out of, or stopped in.
    pub coordinate: Coordinate,
    /// As printed: `Scout` for a unit, `Ship` for a fleet.
    pub mover_name: String,
    /// Bare number: `3744` for a unit, `235` for a fleet.
    pub mover_id: String,
    /// True for `Ship [235] is stopped by guards in ...`; false for a unit kept out.
    pub fleet: bool,
    /// The guard, for a unit kept out. Always `None` for a fleet: the report never names it.
    pub guard: Option<BlockingGuard>,
}

/// Reads every blocked move out of the turn's event lines, in report order. Lines of any other
/// shape are skipped silently: they are ordinary events, not unreadable ones.
#[must_use]
pub fn blocked_moves(events: &[String]) -> Vec<BlockedMove> {
    events
        .iter()
        .filter_map(|line| {
            let line = line.trim();
            let line = line.strip_suffix('.').unwrap_or(line);
            unit_kept_out(line).or_else(|| fleet_stopped(line))
        })
        .collect()
}

/// `Scout (3744): Is forbidden entry to swamp (36,50) in Pangmore by Unit (7235)`.
fn unit_kept_out(line: &str) -> Option<BlockedMove> {
    let (prefix, rest) = line.split_once("): Is forbidden entry to ")?;
    let (mover_name, mover_id) = split_trailing_id(&format!("{prefix})"))?;
    let coordinate = coordinate_after_terrain(rest)?;
    // The first " by " whose remainder reads as a guard: a trailing faction name may itself
    // contain " by ", so the last one is not safe.
    let guard = rest
        .match_indices(" by ")
        .find_map(|(at, by)| guard(&rest[at + by.len()..]))?;
    Some(BlockedMove {
        coordinate,
        mover_name,
        mover_id,
        fleet: false,
        guard: Some(guard),
    })
}

/// `Ship [235] is stopped by guards in ocean (38,44) in Atlantis Ocean`.
fn fleet_stopped(line: &str) -> Option<BlockedMove> {
    let (fleet, rest) = line.split_once(" is stopped by guards in ")?;
    let fleet = fleet.trim().strip_suffix(']')?;
    let open = fleet.rfind('[')?;
    let id = &fleet[open + 1..];
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(BlockedMove {
        coordinate: coordinate_after_terrain(rest)?,
        mover_name: fleet[..open].trim().to_string(),
        mover_id: id.to_string(),
        fleet: true,
        guard: None,
    })
}

/// Reads the `(x,y)` that follows the terrain in `swamp (36,50) in Pangmore ...`.
fn coordinate_after_terrain(text: &str) -> Option<Coordinate> {
    let open = text.find(" (")? + 1;
    let close = open + text[open..].find(')')?;
    parse_coordinate(&text[open..=close])
}

/// `Unit (7235)`, optionally followed by `, Some Faction (41)`, which is dropped.
fn guard(text: &str) -> Option<BlockingGuard> {
    let mut search = 0;
    while let Some(offset) = text[search..].find(')') {
        let close = search + offset;
        if let Some((name, id)) = split_trailing_id(&text[..=close]) {
            return Some(BlockingGuard { name, id });
        }
        search = close + 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(lines: &[&str]) -> Vec<BlockedMove> {
        let events: Vec<String> = lines.iter().map(|line| (*line).to_string()).collect();
        blocked_moves(&events)
    }

    #[test]
    fn reads_a_unit_kept_out_by_a_named_guard() {
        let moves = read(&[
            "Scout (3744): Is forbidden entry to swamp (36,50) in Pangmore by Unit (7235).",
        ]);
        assert_eq!(
            moves,
            vec![BlockedMove {
                coordinate: Coordinate { x: 36, y: 50, z: 1 },
                mover_name: "Scout".into(),
                mover_id: "3744".into(),
                fleet: false,
                guard: Some(BlockingGuard {
                    name: "Unit".into(),
                    id: "7235".into()
                }),
            }]
        );
    }

    fn guard_of(line: &str) -> Option<BlockingGuard> {
        read(&[line]).into_iter().next().and_then(|m| m.guard)
    }

    #[test]
    fn drops_the_guards_faction_when_the_report_names_it() {
        assert_eq!(
            guard_of("Scout (3744): Is forbidden entry to swamp (36,50) in Pangmore by Unit (7235), Some Faction (41)."),
            Some(BlockingGuard { name: "Unit".into(), id: "7235".into() })
        );
    }

    #[test]
    fn keeps_the_guard_when_the_faction_name_says_by() {
        assert_eq!(
            guard_of("Scout (3744): Is forbidden entry to swamp (36,50) in Pangmore by Unit (7235), Stand by Me (41)."),
            Some(BlockingGuard { name: "Unit".into(), id: "7235".into() })
        );
    }

    #[test]
    fn reads_a_named_guard() {
        assert_eq!(
            guard_of("Scout (3744): Is forbidden entry to swamp (36,50) in Pangmore by Guardsmen of Pangmore (7235)."),
            Some(BlockingGuard { name: "Guardsmen of Pangmore".into(), id: "7235".into() })
        );
    }

    #[test]
    fn reads_a_fleet_stopped_by_guards() {
        assert_eq!(
            read(&["Ship [235] is stopped by guards in ocean (38,44) in Atlantis Ocean."]),
            vec![BlockedMove {
                coordinate: Coordinate { x: 38, y: 44, z: 1 },
                mover_name: "Ship".into(),
                mover_id: "235".into(),
                fleet: true,
                guard: None,
            }]
        );
    }

    #[test]
    fn reads_an_underworld_coordinate() {
        let moves = read(&["Drone (9616): Is forbidden entry to tunnels (4,6,underworld) in Deepdark by Unit (7235)."]);
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].coordinate.z, 2);
    }

    #[test]
    fn skips_every_other_event() {
        assert!(read(&[
            "Drone (11852): Rides from swamp (36,46) in Pangmore to swamp (35,47) in Pangmore.",
            "Times reward of 200 silver.",
            "Drone (8578): MOVE: Unit has insufficient movement points; remaining moves queued.",
        ])
        .is_empty());
    }

    #[test]
    fn keeps_report_order() {
        let moves = read(&[
            "Ship [235] is stopped by guards in ocean (38,44) in Atlantis Ocean.",
            "Scout (3744): Is forbidden entry to swamp (36,50) in Pangmore by Unit (7235).",
        ]);
        let ids: Vec<&str> = moves.iter().map(|m| m.mover_id.as_str()).collect();
        assert_eq!(ids, ["235", "3744"]);
    }
}
