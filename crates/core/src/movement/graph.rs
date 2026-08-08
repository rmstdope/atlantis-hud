//! The map a route is planned over.
//!
//! Built from what the faction has actually seen. A report describes far more than the hexes it
//! stood in: every region block names its six neighbours with their terrain and province, which is
//! enough to cost a step into one without ever having been there.
//!
//! Adjacency comes from the coordinates the report states rather than from arithmetic on our own.
//! Atlantis maps wrap east to west, the rules page never says where the seam is, and a computed
//! neighbour would be wrong exactly at the edge - where being wrong matters most. The report simply
//! names the hex on the other side.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::report::model::{Coordinate, ReportRegion, ReportUnit};
use crate::report::ParsedReport;

/// One of the six ways out of a hex.
///
/// Ordered as a report writes them, which is also clockwise from north.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    North,
    Northeast,
    Southeast,
    South,
    Southwest,
    Northwest,
}

impl Direction {
    /// The way back.
    #[must_use]
    pub fn opposite(self) -> Self {
        match self {
            Self::North => Self::South,
            Self::Northeast => Self::Southwest,
            Self::Southeast => Self::Northwest,
            Self::South => Self::North,
            Self::Southwest => Self::Northeast,
            Self::Northwest => Self::Southeast,
        }
    }

    /// How a report writes it, as in `Southwest : jungle (9,51) in Maput.`
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Self::North => "North",
            Self::Northeast => "Northeast",
            Self::Southeast => "Southeast",
            Self::South => "South",
            Self::Southwest => "Southwest",
            Self::Northwest => "Northwest",
        }
    }

    /// How an order writes it, as in `MOVE N NE`.
    #[must_use]
    pub fn abbreviation(self) -> &'static str {
        match self {
            Self::North => "N",
            Self::Northeast => "NE",
            Self::Southeast => "SE",
            Self::South => "S",
            Self::Southwest => "SW",
            Self::Northwest => "NW",
        }
    }

    /// Reads either form, so `SW`, `Southwest` and `southwest` all mean the same thing.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let trimmed = text.trim().trim_end_matches('.');
        [
            Self::North,
            Self::Northeast,
            Self::Southeast,
            Self::South,
            Self::Southwest,
            Self::Northwest,
        ]
        .into_iter()
        .find(|direction| {
            trimmed.eq_ignore_ascii_case(direction.label())
                || trimmed.eq_ignore_ascii_case(direction.abbreviation())
        })
    }
}

/// A hex the faction knows something about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHex {
    pub coordinate: Coordinate,
    pub terrain: String,
    pub province: String,
    /// Whether the faction has actually been here, as opposed to hearing the hex named by a
    /// neighbour's exits. Only a visited hex reports its structures and its units.
    pub visited: bool,
    /// Roads leading out of this hex. Empty for a hex we only know by name, which is not the same
    /// as knowing it has none.
    pub roads: Vec<Direction>,
    /// Units standing here, which is what the risk heuristic weighs. Empty unless visited.
    pub units: Vec<ReportUnit>,
    /// The turn this hex was last seen in, once sightings are carried across turns.
    pub last_seen_turn: Option<u32>,
}

/// Everywhere the faction knows about, and how the hexes join up.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapKnowledge {
    hexes: BTreeMap<String, KnownHex>,
    exits: BTreeMap<String, Vec<(Direction, Coordinate)>>,
    /// Exits held until every hex is in place, so adjacency can be resolved in either direction.
    #[serde(default, skip)]
    pending_exits: BTreeMap<String, Vec<crate::report::model::Exit>>,
}

/// Keys a hex the way the game writes one, so the map is stable and readable in a dump.
fn key(coordinate: Coordinate) -> String {
    coordinate.id()
}

/// A region the faction saw in some earlier turn, recovered from storage.
///
/// Carries the whole region as it was written then, exits included, which is what lets a map
/// accumulated over many turns join up into a graph a route can cross. A single report cannot: its
/// visited hexes name their neighbours, but those neighbours describe no exits of their own, so
/// every route is one step long.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberedRegion {
    pub region: ReportRegion,
    pub last_seen_turn: u32,
}

impl MapKnowledge {
    /// Builds the map from one report.
    ///
    /// Visited regions are entered first and exits second, so a hex that is both - named by a
    /// neighbour and stood in - keeps the fuller of the two descriptions.
    #[must_use]
    pub fn from_report(report: &ParsedReport) -> Self {
        let mut map = Self::default();

        for region in &report.regions {
            map.hexes.insert(
                key(region.coordinate),
                KnownHex {
                    coordinate: region.coordinate,
                    terrain: region.terrain.clone(),
                    province: region.province.clone(),
                    visited: true,
                    roads: region
                        .structures
                        .iter()
                        .filter_map(|structure| structure.kind.strip_prefix("Road "))
                        .filter_map(Direction::parse)
                        .collect(),
                    units: region.units.clone(),
                    last_seen_turn: report.header.turn_number,
                },
            );
        }

        for region in &report.regions {
            let mut exits = Vec::new();
            for exit in &region.exits {
                let Some(direction) = Direction::parse(&exit.direction) else {
                    continue;
                };
                exits.push((direction, exit.coordinate));

                // An exit names a hex the faction may never have visited. That is the third map
                // state: terrain and province are known, which is enough to cost a step into it,
                // and nothing else is.
                map.hexes
                    .entry(key(exit.coordinate))
                    .or_insert_with(|| KnownHex {
                        coordinate: exit.coordinate,
                        terrain: exit.terrain.clone(),
                        province: exit.province.clone(),
                        visited: false,
                        roads: Vec::new(),
                        units: Vec::new(),
                        last_seen_turn: None,
                    });
            }
            map.exits.insert(key(region.coordinate), exits);
        }

        map
    }

    /// Builds the map from everything the faction has ever seen.
    ///
    /// The current report wins wherever the two disagree: a hex described this turn is worth more
    /// than the same hex remembered from turn forty, and only the current description can be
    /// trusted about who is standing in it. Remembered regions fill in everywhere the report is
    /// silent, and bring their own exits, which is what makes the graph span more than one step.
    #[must_use]
    pub fn from_remembered(current: &ParsedReport, remembered: &[RememberedRegion]) -> Self {
        let mut map = Self::default();

        // Oldest first, so a more recent sighting overwrites an older one, and the current report
        // overwrites both.
        let mut ordered: Vec<&RememberedRegion> = remembered.iter().collect();
        ordered.sort_by_key(|entry| entry.last_seen_turn);

        for entry in ordered {
            map.remember(&entry.region, Some(entry.last_seen_turn), false);
        }
        for region in &current.regions {
            map.remember(region, current.header.turn_number, true);
        }

        // Exits are gathered after every hex is in place, so a remembered region can point at one
        // the current report describes and vice versa.
        map.rebuild_exits();
        map
    }

    /// Enters one region, replacing whatever was there.
    fn remember(&mut self, region: &ReportRegion, turn: Option<u32>, current: bool) {
        self.hexes.insert(
            key(region.coordinate),
            KnownHex {
                coordinate: region.coordinate,
                terrain: region.terrain.clone(),
                province: region.province.clone(),
                visited: true,
                roads: region
                    .structures
                    .iter()
                    .filter_map(|structure| structure.kind.strip_prefix("Road "))
                    .filter_map(Direction::parse)
                    .collect(),
                units: if current {
                    region.units.clone()
                } else {
                    Vec::new()
                },
                last_seen_turn: turn,
            },
        );
        self.pending_exits
            .insert(key(region.coordinate), region.exits.clone());
    }

    /// Turns every region's exits into adjacency, and enters the hexes they name.
    fn rebuild_exits(&mut self) {
        let pending = std::mem::take(&mut self.pending_exits);

        for (from, exits) in &pending {
            let mut resolved = Vec::new();
            for exit in exits {
                let Some(direction) = Direction::parse(&exit.direction) else {
                    continue;
                };
                resolved.push((direction, exit.coordinate));

                self.hexes
                    .entry(key(exit.coordinate))
                    .or_insert_with(|| KnownHex {
                        coordinate: exit.coordinate,
                        terrain: exit.terrain.clone(),
                        province: exit.province.clone(),
                        visited: false,
                        roads: Vec::new(),
                        units: Vec::new(),
                        last_seen_turn: None,
                    });
            }
            self.exits.insert(from.clone(), resolved);
        }
    }

    /// How many hexes are known at all, visited or merely named.
    #[must_use]
    pub fn len(&self) -> usize {
        self.hexes.len()
    }

    /// Whether nothing is known yet.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.hexes.is_empty()
    }

    /// How many hexes the faction has actually stood in.
    #[must_use]
    pub fn visited_count(&self) -> usize {
        self.hexes.values().filter(|hex| hex.visited).count()
    }

    /// What is known about one hex, if anything.
    #[must_use]
    pub fn hex(&self, coordinate: Coordinate) -> Option<&KnownHex> {
        self.hexes.get(&key(coordinate))
    }

    /// What is known about one hex, addressed the way the game writes it, as in `1:7,53`.
    #[must_use]
    pub fn hex_by_key(&self, key: &str) -> Option<&KnownHex> {
        self.hexes.get(key)
    }

    /// The hex a unit is standing in.
    ///
    /// A unit carries its own region id, so this is a lookup rather than a search - but it returns
    /// nothing when the map does not know that hex, which is what a caller has to handle.
    #[must_use]
    pub fn hex_of_unit(&self, unit: &ReportUnit) -> Option<&KnownHex> {
        self.hexes.get(&unit.region_id)
    }

    /// The hexes reachable in one step, as the report names them.
    ///
    /// Empty for a hex known only by name: nothing described *its* exits, so the graph stops there
    /// rather than guessing what lies beyond.
    pub fn neighbours(
        &self,
        coordinate: Coordinate,
    ) -> impl Iterator<Item = (Direction, Coordinate)> + '_ {
        self.exits
            .get(&key(coordinate))
            .into_iter()
            .flat_map(|exits| exits.iter().copied())
    }

    /// Whether a road runs the whole way between a hex and its neighbour.
    ///
    /// Both sides must carry one facing the other; a road that stops at the hexside is no help. A
    /// report lists structures only for hexes the faction stood in, so the far side is usually
    /// unknowable - and unknowable is not a bonus.
    #[must_use]
    pub fn road_connects(&self, from: Coordinate, direction: Direction) -> bool {
        let Some((_, neighbour)) = self
            .neighbours(from)
            .find(|(heading, _)| *heading == direction)
        else {
            return false;
        };
        self.road_connects_to(from, direction, neighbour)
    }

    /// The same question, asked about a neighbour the caller has already identified.
    ///
    /// Preferred wherever the neighbour is known, because looking it up by direction alone takes
    /// the *first* exit heading that way - and a hex naming two would have a road credited to the
    /// wrong one.
    #[must_use]
    pub fn road_connects_to(
        &self,
        from: Coordinate,
        direction: Direction,
        neighbour: Coordinate,
    ) -> bool {
        let Some(here) = self.hex(from) else {
            return false;
        };
        if !here.roads.contains(&direction) {
            return false;
        }

        self.hex(neighbour)
            .is_some_and(|far| far.roads.contains(&direction.opposite()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_direction_reverses_to_the_one_facing_it() {
        for direction in [
            Direction::North,
            Direction::Northeast,
            Direction::Southeast,
            Direction::South,
            Direction::Southwest,
            Direction::Northwest,
        ] {
            assert_eq!(direction.opposite().opposite(), direction);
            assert_ne!(direction.opposite(), direction);
        }
    }

    #[test]
    fn reads_both_the_long_and_the_short_form() {
        // A report writes `Southwest : ...`; an order writes `MOVE SW`.
        assert_eq!(Direction::parse("Southwest"), Some(Direction::Southwest));
        assert_eq!(Direction::parse("SW"), Some(Direction::Southwest));
        assert_eq!(Direction::parse("sw"), Some(Direction::Southwest));
        assert_eq!(Direction::parse(" South. "), Some(Direction::South));
    }

    /// `S` and `SE` share a prefix, and `N`, `NE`, `NW` share one too. Matching loosely would send
    /// a unit the wrong way, which is worse than refusing to plan.
    #[test]
    fn does_not_confuse_directions_that_share_a_prefix() {
        assert_eq!(Direction::parse("S"), Some(Direction::South));
        assert_eq!(Direction::parse("SE"), Some(Direction::Southeast));
        assert_eq!(Direction::parse("N"), Some(Direction::North));
        assert_eq!(Direction::parse("NE"), Some(Direction::Northeast));
        assert_eq!(Direction::parse("NW"), Some(Direction::Northwest));
    }

    #[test]
    fn refuses_something_that_is_not_a_direction() {
        for text in ["", "IN", "OUT", "up", "Northwestern"] {
            assert_eq!(Direction::parse(text), None, "{text} should be refused");
        }
    }

    #[test]
    fn an_empty_map_knows_nothing() {
        let map = MapKnowledge::default();
        assert!(map.is_empty());
        assert_eq!(map.len(), 0);
        assert_eq!(map.visited_count(), 0);
        assert_eq!(map.neighbours(Coordinate { x: 0, y: 0, z: 1 }).count(), 0);
        assert!(!map.road_connects(Coordinate { x: 0, y: 0, z: 1 }, Direction::North));
    }
}
