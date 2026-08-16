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
//! 3. **Stored sightings are read with the legacy nexus repair applied** (see
//!    `with_nexus_level_repaired`): a nexus stored before ah-4b4 at `(0,0)` on the surface is given
//!    its own level back, so an imported game is right after the fix without a store migration.
//!    Each remembered region overwrites whatever a hex's
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

use crate::cache::ReportCache;
use crate::movement::graph::RememberedRegion;
use crate::report::level;
use crate::report::model::{Coordinate, ReportRegion, Settlement};
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
    /// The settlement the hex's description names, if any - the exit's for a `Named` hex, the
    /// region's own for a visited one. The screen labels the hex with it.
    pub settlement: Option<Settlement>,
}

/// One level the known map has hexes on, with the word the level control shows for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapLevel {
    pub z: u32,
    pub name: String,
}

/// Everything the faction knows, resolved once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownMap {
    /// Sorted by z, then y, then x - the order the screen has always drawn in.
    pub hexes: Vec<KnownMapHex>,
    /// The distinct levels `hexes` holds, ascending by `z`, each named by
    /// [`crate::report::level::level_name`]. Empty when there are no hexes.
    pub levels: Vec<MapLevel>,
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

/// A nexus sighting stored before ah-4b4 was filed on the surface (`1:0,0`, terrain `nexus`)
/// because the parser could not read its level. It is the same hex; give it its level back so a
/// game imported before the fix draws the nexus where the fix puts it, without a store migration.
///
/// A region's own coordinate is not the only place this can be wrong: its `exits` carry their own
/// coordinates too (`Exit.coordinate`), so a neighbour's pre-fix sighting that names the nexus in
/// its own exits list is repaired the same way, or Rule 1 would still file a phantom `Named` hex at
/// the surface origin alongside the repaired direct sighting.
fn with_nexus_level_repaired(entry: &RememberedRegion) -> RememberedRegion {
    let region_is_misfiled =
        entry.region.terrain == "nexus" && entry.region.coordinate.z == level::SURFACE;
    let any_exit_is_misfiled = entry
        .region
        .exits
        .iter()
        .any(|exit| exit.terrain == "nexus" && exit.coordinate.z == level::SURFACE);
    if !region_is_misfiled && !any_exit_is_misfiled {
        return entry.clone();
    }

    let mut repaired = entry.clone();
    if region_is_misfiled {
        repaired.region.coordinate.z = level::NEXUS;
        repaired.region.region_id = repaired.region.coordinate.id();
    }
    for exit in &mut repaired.region.exits {
        if exit.terrain == "nexus" && exit.coordinate.z == level::SURFACE {
            exit.coordinate.z = level::NEXUS;
        }
    }
    repaired
}

/// Everything the faction knows, resolved once. See the module doc for the precedence rules.
///
/// Stored sightings are read with the legacy nexus repair applied first (see
/// `with_nexus_level_repaired`), so a game imported before ah-4b4 is right after it too.
#[must_use]
pub fn resolve_known_map(current: &ParsedReport, remembered: &[RememberedRegion]) -> KnownMap {
    let current_turn = current.header.turn_number;
    let mut by_key: BTreeMap<String, KnownMapHex> = BTreeMap::new();

    let remembered: Vec<RememberedRegion> =
        remembered.iter().map(with_nexus_level_repaired).collect();

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
                    settlement: exit.settlement.clone(),
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
                    settlement: exit.settlement.clone(),
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
                settlement: entry.region.settlement.clone(),
                region: Some(region),
            },
        );
    }

    // Rule 4: the current report's own regions always win. `stored_by_key` is what
    // `with_allies_units` reads to find a same-turn ally sighting of the same hex - built from
    // `ordered` (oldest first, the same list Rule 3 walks) rather than `remembered` in whatever
    // order it arrived, so a duplicate direct sighting of one coordinate resolves to the most
    // recent one here too, deterministically, rather than to whichever the input happened to list
    // last.
    let mut stored_by_key: BTreeMap<String, &RememberedRegion> = BTreeMap::new();
    for entry in &ordered {
        stored_by_key.insert(key(entry.region.coordinate), *entry);
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
                settlement: resolved.settlement.clone(),
                region: Some(resolved),
            },
        );
    }

    let mut hexes: Vec<KnownMapHex> = by_key.into_values().collect();
    hexes.sort_by_key(|hex| (hex.coordinate.z, hex.coordinate.y, hex.coordinate.x));

    let mut levels: Vec<MapLevel> = Vec::new();
    for hex in &hexes {
        if levels.last().is_none_or(|last| last.z != hex.coordinate.z) {
            levels.push(MapLevel {
                z: hex.coordinate.z,
                name: level::level_name(hex.coordinate.z),
            });
        }
    }

    KnownMap {
        hexes,
        levels,
        current_turn,
    }
}

/// The boundary's entry: parses the raw report - classified when a ruleset is to hand, so units
/// carry exact men counts the same way `command_merge_report` and `validate_orders` already parse
/// classified - reads the remembered regions from their JSON, and resolves.
///
/// # Errors
///
/// Returns an error when the remembered regions cannot be read.
pub fn known_map_json(
    cache: &mut ReportCache,
    raw_report: &str,
    ruleset_json: Option<&str>,
    remembered_json: &str,
) -> Result<KnownMap, String> {
    let remembered: Vec<RememberedRegion> = serde_json::from_str(remembered_json)
        .map_err(|error| format!("remembered regions could not be read: {error}"))?;

    let report = cache.classified_when_possible(raw_report, ruleset_json);
    Ok(resolve_known_map(&report, &remembered))
}
