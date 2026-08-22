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

use crate::report::model::{Coordinate, ReportRegion, ReportUnit, Structure};
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
    /// Every way out of a hex, clockwise from north, as a report writes them.
    pub const ALL: [Self; 6] = [
        Self::North,
        Self::Northeast,
        Self::Southeast,
        Self::South,
        Self::Southwest,
        Self::Northwest,
    ];

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

    /// Where one step this way lands on the hex lattice, as `(dx, dy)`.
    ///
    /// The lattice only holds hexes where `x + y` is even, so vertical steps move two rows and
    /// diagonal steps one row and one column.
    #[must_use]
    pub fn offset(self) -> (i32, i32) {
        match self {
            Self::North => (0, -2),
            Self::Northeast => (1, -1),
            Self::Southeast => (1, 1),
            Self::South => (0, 2),
            Self::Southwest => (-1, 1),
            Self::Northwest => (-1, -1),
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

/// How far a map runs, and where it joins back onto itself.
///
/// The game server's world rather than the rules: the rules page never states a size, so this
/// arrives from the game the player described rather than from a scrape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapGeometry {
    /// Columns, in coordinate space. A map 72 wide runs `x` from 0 to 71.
    pub width: i32,
    /// Rows, in coordinate space, counting the lattice's empty rows.
    pub height: i32,
    pub wrap_x: bool,
    pub wrap_y: bool,
}

impl MapGeometry {
    /// Brings a coordinate back onto the map, on whichever axes this map actually wraps.
    ///
    /// A dimension that is not positive is treated as unknown rather than as an error: a zero
    /// width would otherwise divide by zero, and refusing outright would take away a route the
    /// planner could still draw approximately.
    #[must_use]
    fn wrap(self, coordinate: Coordinate) -> Coordinate {
        let x = if self.wrap_x && self.width > 0 {
            coordinate.x.rem_euclid(self.width)
        } else {
            coordinate.x
        };
        let y = if self.wrap_y && self.height > 0 {
            coordinate.y.rem_euclid(self.height)
        } else {
            coordinate.y
        };
        Coordinate {
            x,
            y,
            z: coordinate.z,
        }
    }
}

/// The coordinate a step lands on when the map itself cannot say.
///
/// This is the arithmetic the module header warns against, kept as the deliberate exception: an
/// order marching into unexplored country has no report-stated exit to follow, and drawing the
/// intent roughly right everywhere except across the wrap seam beats drawing nothing. Callers must
/// prefer a stated exit wherever one exists.
///
/// `geometry` is what the seam warning was about. Given the map's size, the step across the seam
/// is exact rather than approximate; given `None` - a game that never recorded one, or a ruleset
/// that declares no default - the arithmetic is exactly what it always was, because a guessed
/// width would put a seam where the map has none.
///
/// **This improves the fallback, not the primary.** A stated exit is still the map's own word and
/// still wins: a player-entered width can be wrong where a reported neighbour cannot.
#[must_use]
pub fn geometric_neighbour(
    from: Coordinate,
    direction: Direction,
    geometry: Option<MapGeometry>,
) -> Coordinate {
    let (dx, dy) = direction.offset();
    let stepped = Coordinate {
        x: from.x + dx,
        y: from.y + dy,
        z: from.z,
    };
    geometry.map_or(stepped, |map| map.wrap(stepped))
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
    /// Every structure standing here, fleets included. Empty unless visited, for the same reason
    /// roads are: a report only lists structures for a hex the faction stood in.
    pub structures: Vec<Structure>,
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
    /// The shape of the map these hexes sit on, when the game has been told one.
    ///
    /// It rides on the map rather than being passed beside it because every caller that computes a
    /// neighbour already holds the map, and a second parameter threaded through each of them is a
    /// second thing to forget. `None` means the game never said, and the arithmetic then behaves
    /// exactly as it did before this field existed.
    #[serde(default)]
    geometry: Option<MapGeometry>,
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
    /// The same map, told what shape it is.
    ///
    /// Separate from the constructors so the resolution rules stay in one place and every entry
    /// point gains the geometry the same way.
    #[must_use]
    pub fn with_geometry(mut self, geometry: Option<MapGeometry>) -> Self {
        self.geometry = geometry;
        self
    }

    /// The shape of this map, or `None` when the game never recorded one.
    #[must_use]
    pub fn geometry(&self) -> Option<MapGeometry> {
        self.geometry
    }

    /// Where one step this way lands, using this map's own shape.
    ///
    /// The fallback for unexplored country only: callers still prefer a stated exit wherever one
    /// exists, and this is the arithmetic they fall back to.
    #[must_use]
    pub fn geometric_neighbour(&self, from: Coordinate, direction: Direction) -> Coordinate {
        geometric_neighbour(from, direction, self.geometry)
    }

    /// Builds the map from one report.
    ///
    /// Visited regions are entered first and exits second, so a hex that is both - named by a
    /// neighbour and stood in - keeps the fuller of the two descriptions.
    ///
    /// This is the no-memory path, and resolving with an empty `remembered` slice describes exactly
    /// the same map (`from_report_agrees_with_from_remembered_given_nothing_remembered`,
    /// `movement_graph.rs`) - so it delegates rather than carrying its own copy of the same rules.
    #[must_use]
    pub fn from_report(report: &ParsedReport) -> Self {
        Self::from_remembered(report, &[])
    }

    /// Builds the map from everything the faction has ever seen.
    ///
    /// The precedence rules - current beats remembered, visited beats merely named, a same-turn
    /// ally sighting is as current as anything else on screen - are decided once, in
    /// [`resolve_known_map`](crate::known_map::resolve_known_map). This is that resolution, turned
    /// into the shape the planner and the risk heuristic read.
    #[must_use]
    pub fn from_remembered(current: &ParsedReport, remembered: &[RememberedRegion]) -> Self {
        let known = crate::known_map::resolve_known_map(current, remembered);
        Self::from_known_map(&known)
    }

    /// Turns a resolution into the graph the planner and the risk heuristic read.
    ///
    /// Adjacency and one planning-only rule live here rather than in the resolution itself: a
    /// fleet can sail away, so only a `Current` hex may contribute the structures planning counts
    /// on being there. The resolver decides *who is there*; this decides *what planning may count*.
    #[must_use]
    pub fn from_known_map(known: &crate::known_map::KnownMap) -> Self {
        use crate::known_map::HexKnowledge;

        let mut map = Self::default();

        for hex in &known.hexes {
            let (roads, structures, units) = match &hex.region {
                Some(region) => {
                    let roads = region
                        .structures
                        .iter()
                        .filter_map(|structure| structure.kind.strip_prefix("Road "))
                        .filter_map(Direction::parse)
                        .collect();
                    let structures = if hex.knowledge == HexKnowledge::Current {
                        region.structures.clone()
                    } else {
                        Vec::new()
                    };
                    (roads, structures, region.units.clone())
                }
                None => (Vec::new(), Vec::new(), Vec::new()),
            };

            map.hexes.insert(
                key(hex.coordinate),
                KnownHex {
                    coordinate: hex.coordinate,
                    terrain: hex.terrain.clone(),
                    province: hex.province.clone(),
                    visited: hex.knowledge != HexKnowledge::Named,
                    roads,
                    structures,
                    units,
                    last_seen_turn: hex.last_seen_turn,
                },
            );
            if let Some(region) = &hex.region {
                map.pending_exits
                    .insert(key(hex.coordinate), region.exits.clone());
            }
        }

        // Exits are gathered after every hex is in place, so a remembered region can point at one
        // the current report describes and vice versa.
        map.rebuild_exits();
        map
    }

    /// Turns every region's exits into adjacency, and enters the hexes they name.
    ///
    /// This is also a defence for a hex the resolution has not already placed: it should not
    /// happen, since every named hex is entered by `from_known_map` above, but `or_insert_with`
    /// costs nothing and a silently-dropped exit target would be worse.
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
                        structures: Vec::new(),
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

    /// Every hex the faction knows anything about, in no particular order.
    ///
    /// The planner uses this to work out how far its search may wander into unexplored country:
    /// the ground that is known is what bounds the ground that is guessed at.
    pub fn coordinates(&self) -> impl Iterator<Item = Coordinate> + '_ {
        self.hexes.values().map(|hex| hex.coordinate)
    }

    /// What is known about one hex, if anything.
    #[must_use]
    pub fn hex(&self, coordinate: Coordinate) -> Option<&KnownHex> {
        self.hexes.get(&key(coordinate))
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

    /// The lattice puts hexes only where `x + y` is even, so North and South cross two rows while
    /// the diagonals cross one row and one column. Getting one of these wrong draws an order's
    /// path into a hex that does not exist.
    #[test]
    fn each_direction_steps_to_the_adjacent_lattice_point() {
        assert_eq!(Direction::North.offset(), (0, -2));
        assert_eq!(Direction::Northeast.offset(), (1, -1));
        assert_eq!(Direction::Southeast.offset(), (1, 1));
        assert_eq!(Direction::South.offset(), (0, 2));
        assert_eq!(Direction::Southwest.offset(), (-1, 1));
        assert_eq!(Direction::Northwest.offset(), (-1, -1));
    }

    #[test]
    fn a_geometric_step_stays_on_the_lattice_and_on_the_level() {
        let from = Coordinate { x: 7, y: 53, z: 1 };
        for direction in [
            Direction::North,
            Direction::Northeast,
            Direction::Southeast,
            Direction::South,
            Direction::Southwest,
            Direction::Northwest,
        ] {
            let stepped = geometric_neighbour(from, direction, None);
            assert_eq!(
                (stepped.x + stepped.y).rem_euclid(2),
                0,
                "{direction:?} left the lattice at {stepped:?}"
            );
            assert_ne!((stepped.x, stepped.y), (from.x, from.y));
            assert_eq!(stepped.z, from.z, "{direction:?} changed level");
        }
    }

    /// A step and the step back must cancel, or a MOVE N S order would drift.
    #[test]
    fn a_geometric_step_reversed_comes_home() {
        let from = Coordinate { x: 7, y: 53, z: 1 };
        for direction in [
            Direction::North,
            Direction::Northeast,
            Direction::Southeast,
            Direction::South,
            Direction::Southwest,
            Direction::Northwest,
        ] {
            let there = geometric_neighbour(from, direction, None);
            let back = geometric_neighbour(there, direction.opposite(), None);
            assert_eq!(back, from, "{direction:?} then back drifted");
        }
    }

    /// The whole point of the bead: east of the last column is column 0, not a hex off the map.
    #[test]
    fn a_geometric_step_east_of_the_last_column_wraps_to_the_first() {
        let map = MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
        };
        let from = Coordinate { x: 71, y: 41, z: 1 };

        let stepped = geometric_neighbour(from, Direction::Southeast, Some(map));

        assert_eq!(stepped, Coordinate { x: 0, y: 42, z: 1 });
    }

    /// Unknown dimensions must behave exactly as they did before this existed, so every game
    /// created before it - and every backup restored from before it - keeps working unchanged.
    #[test]
    fn a_geometric_step_with_unknown_dimensions_does_not_wrap() {
        let from = Coordinate { x: 71, y: 41, z: 1 };

        let stepped = geometric_neighbour(from, Direction::Southeast, None);

        assert_eq!(stepped, Coordinate { x: 72, y: 42, z: 1 });
    }

    /// A map that runs east to west but not north to south must not wrap the axis it does not.
    #[test]
    fn a_geometric_step_off_the_last_row_does_not_wrap_unless_the_map_says_so() {
        let map = MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
        };
        let from = Coordinate { x: 4, y: 94, z: 1 };

        let stepped = geometric_neighbour(from, Direction::South, Some(map));

        assert_eq!(stepped, Coordinate { x: 4, y: 96, z: 1 });
    }

    /// `wrapY` is honoured, not merely recorded - a control that did nothing would be worse than
    /// no control at all.
    #[test]
    fn a_geometric_step_off_the_last_row_wraps_when_the_map_wraps_north_to_south() {
        let map = MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: true,
        };
        let from = Coordinate { x: 4, y: 94, z: 1 };

        let stepped = geometric_neighbour(from, Direction::South, Some(map));

        assert_eq!(stepped, Coordinate { x: 4, y: 0, z: 1 });
    }

    /// Wrapping must keep the lattice invariant `x + y` even, or a wrapped step lands on a hex the
    /// game does not have.
    #[test]
    fn a_wrapped_step_stays_on_the_lattice() {
        let map = MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: true,
        };
        for (from, direction) in [
            (Coordinate { x: 71, y: 41, z: 1 }, Direction::Southeast),
            (Coordinate { x: 0, y: 40, z: 1 }, Direction::Southwest),
            (Coordinate { x: 4, y: 94, z: 1 }, Direction::South),
            (Coordinate { x: 4, y: 0, z: 1 }, Direction::North),
        ] {
            let stepped = geometric_neighbour(from, direction, Some(map));
            assert_eq!(
                (stepped.x + stepped.y).rem_euclid(2),
                0,
                "{direction:?} from {from:?} left the lattice at {stepped:?}"
            );
        }
    }

    /// A map records its geometry when it is told one, and admits to none when it is not.
    #[test]
    fn a_map_carries_the_geometry_it_was_given() {
        let map = MapKnowledge::default();
        assert_eq!(map.geometry(), None);

        let shape = MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
        };
        assert_eq!(map.with_geometry(Some(shape)).geometry(), Some(shape));
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
