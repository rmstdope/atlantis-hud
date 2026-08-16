//! Resolves everything the faction knows about the map, once, so every consumer - the planner, the
//! risk heuristic and (from ah-u4e.3) the screen - sees the same answer to "who is here".
//!
//! The rules, applied in this order (weakest first, each later rule overwriting the last):
//!
//! 1. **Namings from memory**: a remembered region's exits, oldest sighting first (stable sort on
//!    `last_seen_turn`), and within one turn the first naming of a hex wins. Each yields a `Named`
//!    hex carrying the exit's terrain and province, `last_seen_turn` set to that sighting's turn.
//! 2. **Namings from the current report**: the current report's own exits, first naming wins,
//!    `last_seen_turn` set to the current turn. These overwrite memory's namings unconditionally.
//! 3. **Stored sightings**, oldest first: each remembered region overwrites whatever a hex's
//!    coordinate currently resolves to, so two direct sightings of the same hex - storage is
//!    expected to hand back at most one, but nothing enforces it - settle on the more recent one
//!    rather than an unspecified iteration order. A sighting from the current turn (a same-turn
//!    ally sighting) is `Current` and keeps its units; an older one is `Stale` and has its units
//!    dropped - a fleet can sail away, and only a sighting this fresh can vouch for who is still
//!    there. Terrain, province and exits always come from the region as stored.
//! 4. **The current report's own regions**: `Current`, `last_seen_turn` set to the current turn,
//!    the region as reported, plus any unit a same-turn stored sighting names that the report does
//!    not - appended and marked foreign, additive only, and only for a sighting of this same turn
//!    (`with_allies_units`).
//!
//! Everything else - adjacency, and the planning-only rule that only a `Current` hex may contribute
//! structures - is [`crate::movement::graph::MapKnowledge`]'s to decide, derived from this
//! resolution rather than duplicating it.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::movement::graph::RememberedRegion;
use crate::report::model::{Coordinate, ReportRegion};
use crate::report::ParsedReport;

/// How much can be trusted about a hex on the accumulated map.
///
/// The same three words the screen has used since `hexMapModel.ts`'s `HexKnowledge` - owned here
/// now, and ported to the screen's model by ah-u4e.3.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HexKnowledge {
    /// Described by the current report, or by a stored sighting of this same turn.
    Current,
    /// Described by an earlier turn's sighting. Trustworthy about terrain and roads; not about who
    /// is standing there.
    Stale,
    /// Never visited - known only because some sighting's exits named it.
    Named,
}

/// One hex, resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownMapHex {
    pub coordinate: Coordinate,
    pub terrain: String,
    pub province: String,
    pub knowledge: HexKnowledge,
    /// The turn this description dates from: the current turn, the sighting's turn, or the turn of
    /// the exit that named it. `None` only when the current report itself carries no turn number.
    pub last_seen_turn: Option<u32>,
    /// The region as it may be shown or planned over: the current report's block (plus a same-turn
    /// ally's extra units, marked foreign); a same-turn ally sighting as stored; an older sighting
    /// with its units dropped. `None` for a hex merely named by an exit.
    pub region: Option<ReportRegion>,
}

/// Everything the faction knows, resolved once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownMap {
    /// Sorted by z, then y, then x - the order the screen has always drawn in.
    pub hexes: Vec<KnownMapHex>,
    pub current_turn: Option<u32>,
}

/// A hex's canonical key, matching how the game writes one.
fn key(coordinate: Coordinate) -> String {
    coordinate.id()
}

/// Applies a same-turn ally's extra units to the current report's own account of a hex.
///
/// Additive only: nothing the current report already names is replaced, and every unit
/// contributed this way is marked foreign, since the merge cannot know it is one of ours. Restricted
/// to a sighting of *this* turn - an older one describes the hex before whatever has happened in it
/// since, and letting that intrude would put a stale garrison back on the board.
fn with_allies_units(
    region: &ReportRegion,
    stored: Option<&RememberedRegion>,
    current_turn: Option<u32>,
) -> ReportRegion {
    let Some(stored) = stored else {
        return region.clone();
    };
    let Some(current_turn) = current_turn else {
        return region.clone();
    };
    if stored.last_seen_turn != current_turn {
        return region.clone();
    }

    let named: HashSet<&str> = region
        .units
        .iter()
        .map(|unit| unit.unit_id.as_str())
        .collect();
    let extra: Vec<_> = stored
        .region
        .units
        .iter()
        .filter(|unit| !named.contains(unit.unit_id.as_str()))
        .cloned()
        .collect();
    if extra.is_empty() {
        return region.clone();
    }

    let mut merged = region.clone();
    merged.units.extend(extra.into_iter().map(|mut unit| {
        unit.own = false;
        unit
    }));
    merged
}

/// Everything the faction knows, resolved once. See the module doc for the precedence rules.
#[must_use]
pub fn resolve_known_map(current: &ParsedReport, remembered: &[RememberedRegion]) -> KnownMap {
    let current_turn = current.header.turn_number;
    let mut by_key: BTreeMap<String, KnownMapHex> = BTreeMap::new();

    // Rule 1: namings from memory, oldest sighting first, first naming in a turn wins.
    let mut ordered: Vec<&RememberedRegion> = remembered.iter().collect();
    ordered.sort_by_key(|entry| entry.last_seen_turn);

    let mut named_in_turn: BTreeMap<String, u32> = BTreeMap::new();
    for entry in &ordered {
        for exit in &entry.region.exits {
            let exit_key = key(exit.coordinate);
            if named_in_turn.get(&exit_key) == Some(&entry.last_seen_turn) {
                continue;
            }
            named_in_turn.insert(exit_key.clone(), entry.last_seen_turn);
            by_key.insert(
                exit_key,
                KnownMapHex {
                    coordinate: exit.coordinate,
                    terrain: exit.terrain.clone(),
                    province: exit.province.clone(),
                    knowledge: HexKnowledge::Named,
                    last_seen_turn: Some(entry.last_seen_turn),
                    region: None,
                },
            );
        }
    }

    // Rule 2: namings from the current report, first naming wins, and these always overwrite
    // memory's namings - whatever turn they carry, it is the account being read right now.
    let mut named_now: HashSet<String> = HashSet::new();
    for region in &current.regions {
        for exit in &region.exits {
            let exit_key = key(exit.coordinate);
            if named_now.contains(&exit_key) {
                continue;
            }
            named_now.insert(exit_key.clone());
            by_key.insert(
                exit_key,
                KnownMapHex {
                    coordinate: exit.coordinate,
                    terrain: exit.terrain.clone(),
                    province: exit.province.clone(),
                    knowledge: HexKnowledge::Named,
                    last_seen_turn: current_turn,
                    region: None,
                },
            );
        }
    }

    // Rule 3: stored sightings, oldest first - the same order Rule 1 uses, and for the same
    // reason: storage is expected to hand back one sighting per coordinate, but if it ever hands
    // back two direct sightings of the same hex, the more recent one should be the one that
    // survives rather than whichever happened to be listed first.
    for entry in &ordered {
        let entry_key = key(entry.region.coordinate);
        let is_current_turn = current_turn == Some(entry.last_seen_turn);
        let region = if is_current_turn {
            entry.region.clone()
        } else {
            ReportRegion {
                units: Vec::new(),
                ..entry.region.clone()
            }
        };
        by_key.insert(
            entry_key,
            KnownMapHex {
                coordinate: entry.region.coordinate,
                terrain: entry.region.terrain.clone(),
                province: entry.region.province.clone(),
                knowledge: if is_current_turn {
                    HexKnowledge::Current
                } else {
                    HexKnowledge::Stale
                },
                last_seen_turn: Some(entry.last_seen_turn),
                region: Some(region),
            },
        );
    }

    // Rule 4: the current report's own regions always win.
    let mut stored_by_key: BTreeMap<String, &RememberedRegion> = BTreeMap::new();
    for entry in remembered {
        stored_by_key.insert(key(entry.region.coordinate), entry);
    }
    for region in &current.regions {
        let region_key = key(region.coordinate);
        let resolved = with_allies_units(
            region,
            stored_by_key.get(&region_key).copied(),
            current_turn,
        );
        by_key.insert(
            region_key,
            KnownMapHex {
                coordinate: region.coordinate,
                terrain: resolved.terrain.clone(),
                province: resolved.province.clone(),
                knowledge: HexKnowledge::Current,
                last_seen_turn: current_turn,
                region: Some(resolved),
            },
        );
    }

    let mut hexes: Vec<KnownMapHex> = by_key.into_values().collect();
    hexes.sort_by_key(|hex| (hex.coordinate.z, hex.coordinate.y, hex.coordinate.x));

    KnownMap {
        hexes,
        current_turn,
    }
}
