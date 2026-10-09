//! Whether the map known from the reports lets a `CREATE VILLAGE` found its village (`ah-m24v`).
//!
//! `newage trident rules/create_village`: the region "must be at least 3 hexes away from any other
//! settlement". The founding hex's own settlement and terrain are the ledger's to read from the
//! report (`semantics::create_village`); the distance needs the hexes around it, which only the
//! known map carries, so it is worked out here, beside the remembered map, as walls are
//! (`walls.rs`), and handed to the checks through `CheckOptions::village_sites`.

use std::collections::BTreeMap;

use crate::known_map::KnownMap;
use crate::movement::graph::MapGeometry;
use crate::movement::rules::Ruleset;
use crate::report::model::Coordinate;
use crate::report::ParsedReport;

/// What the known map says about founding a village in one hex.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VillageSite {
    /// Every hex within two is known, and none holds a settlement.
    Clear,
    /// A settlement the known map shows within two hexes: the founding is refused.
    TooClose {
        /// The settlement as the warning names it, `Oldtown [village]`.
        settlement: String,
        coordinate: Coordinate,
    },
    /// Some hex within two is on no report, so a settlement there cannot be ruled out. The
    /// navigator's answer on `ah-m24v`: the founders are consumed, with a warning.
    Unsure,
}

impl VillageSite {
    /// The warning the founding order carries, or `None` for a clear site.
    #[must_use]
    pub fn warning(&self) -> Option<String> {
        match self {
            Self::Clear => None,
            Self::TooClose {
                settlement,
                coordinate,
            } => Some(format!(
                "CREATE VILLAGE will be refused: {settlement} at ({},{}) is within 2 hexes, and a \
                 village must be at least 3 hexes from any other settlement",
                coordinate.x, coordinate.y
            )),
            Self::Unsure => Some(
                "a settlement within 2 hexes may not be visible on the known map; CREATE VILLAGE \
                 is refused if there is one"
                    .to_string(),
            ),
        }
    }
}

/// Keyed by the founding region's id. A region with no entry is [`VillageSite::Unsure`]: a caller
/// without the known map knows nothing about the hexes around it.
pub type VillageSites = BTreeMap<String, VillageSite>;

/// The 18 steps to the hexes within two of a hex, `x + y` keeping its parity: the six neighbours
/// (`(0,±2)`, `(±1,±1)`) and the twelve beyond them.
const WITHIN_TWO: [(i32, i32); 18] = [
    (0, -2),
    (1, -1),
    (1, 1),
    (0, 2),
    (-1, 1),
    (-1, -1),
    (0, -4),
    (1, -3),
    (2, -2),
    (2, 0),
    (2, 2),
    (1, 3),
    (0, 4),
    (-1, 3),
    (-2, 2),
    (-2, 0),
    (-2, -2),
    (-1, -3),
];

/// The verdict for every report region holding an own unit, when the document writes a Trident
/// `CREATE` anywhere. Empty, at the cost of one scan of the orders, for a document that founds
/// nothing: `known` is built only when something founds, since this runs on every keystroke and
/// the known map is a walk of every remembered region.
///
/// Every region with an own unit rather than only those of the units writing `CREATE`, because a
/// unit a `FORM` creates this month founds in its parent's region and has no number to look up
/// there; the ledger judges whichever unit actually founds (review finding 1 on PR #1487).
#[must_use]
pub fn village_sites(
    report: &ParsedReport,
    known: impl FnOnce() -> KnownMap,
    orders_document: &str,
    ruleset: &Ruleset,
    geometry: Option<MapGeometry>,
) -> VillageSites {
    if !super::grammar::is_trident(Some(ruleset)) || !writes_create(orders_document) {
        return VillageSites::new();
    }
    let known = known();
    report
        .regions
        .iter()
        .filter(|region| region.units.iter().any(|unit| unit.own))
        .map(|region| {
            (
                region.region_id.clone(),
                site(region.coordinate, &known, geometry),
            )
        })
        .collect()
}

/// Whether any line of the document, `FORM` blocks included, is a `CREATE` order. Generous on
/// purpose: a line that only looks like one costs a verdict nobody reads, while a missed one
/// leaves a founder unsure.
fn writes_create(orders_document: &str) -> bool {
    orders_document.lines().any(|line| {
        let order = line.split(';').next().unwrap_or("").trim();
        let order = order.strip_prefix('@').unwrap_or(order);
        order
            .split_whitespace()
            .next()
            .is_some_and(|keyword| keyword.eq_ignore_ascii_case("CREATE"))
    })
}

/// The verdict for founding at `at`.
fn site(at: Coordinate, known: &KnownMap, geometry: Option<MapGeometry>) -> VillageSite {
    let geometry = geometry.and_then(|map| map.at_level(at.z));
    let mut unsure = false;
    for (dx, dy) in WITHIN_TWO {
        let Some(near) = on_the_map(at.x + dx, at.y + dy, at.z, geometry) else {
            continue;
        };
        match known.hexes.iter().find(|hex| hex.coordinate == near) {
            Some(hex) => {
                if let Some(settlement) = &hex.settlement {
                    return VillageSite::TooClose {
                        settlement: format!("{} [{}]", settlement.name, settlement.size),
                        coordinate: near,
                    };
                }
            }
            None => unsure = true,
        }
    }
    if unsure {
        VillageSite::Unsure
    } else {
        VillageSite::Clear
    }
}

/// Whether `b` is `a` or within two hexes of it, on a map that wraps as `geometry` says: the
/// reach of `newage trident rules/create_village`'s "at least 3 hexes away from any other
/// settlement", used to tell which of this month's foundings refuse each other (`ah-flx2`).
pub(crate) fn within_two(a: Coordinate, b: Coordinate, geometry: Option<MapGeometry>) -> bool {
    if a.z != b.z {
        return false;
    }
    if a == b {
        return true;
    }
    let geometry = geometry.and_then(|map| map.at_level(a.z));
    WITHIN_TWO
        .iter()
        .any(|(dx, dy)| on_the_map(a.x + dx, a.y + dy, a.z, geometry) == Some(b))
}

/// The hex at (`x`,`y`), brought back onto a map that wraps, or `None` past the edge of one the
/// game recorded as not wrapping. With no shape recorded every coordinate is taken as it is.
fn on_the_map(x: i32, y: i32, z: u32, geometry: Option<MapGeometry>) -> Option<Coordinate> {
    let Some(map) = geometry else {
        return Some(Coordinate { x, y, z });
    };
    let axis = |value: i32, wraps: bool, span: i32| {
        if span <= 0 {
            Some(value)
        } else if wraps {
            Some(value.rem_euclid(span))
        } else if (0..span).contains(&value) {
            Some(value)
        } else {
            None
        }
    };
    Some(Coordinate {
        x: axis(x, map.wrap_x, map.width)?,
        y: axis(y, map.wrap_y, map.height)?,
        z,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_steps_are_exactly_the_hexes_within_two() {
        let shown = crate::movement::graph::ShownExtent::default();
        let from = Coordinate { x: 10, y: 10, z: 1 };
        let geometry = Some(MapGeometry {
            width: 100,
            height: 100,
            wrap_x: false,
            wrap_y: false,
            levels: None,
        });
        let mut within = 0;
        for x in 0..20 {
            for y in 0..20 {
                if (x + y) % 2 != 0 || (x, y) == (10, 10) {
                    continue;
                }
                let to = Coordinate { x, y, z: 1 };
                let distance = crate::movement::graph::hex_distance(from, to, geometry, &shown);
                if matches!(distance, Some(crate::movement::graph::HexDistance::Exact(d)) if d <= 2)
                {
                    within += 1;
                    assert!(
                        WITHIN_TWO.contains(&(x - 10, y - 10)),
                        "({x},{y}) is within two"
                    );
                }
            }
        }
        assert_eq!(within, WITHIN_TWO.len());
    }

    #[test]
    fn a_hex_past_the_edge_of_a_map_that_does_not_wrap_is_not_on_it() {
        let map = MapGeometry {
            width: 8,
            height: 8,
            wrap_x: true,
            wrap_y: false,
            levels: None,
        };
        assert_eq!(
            on_the_map(-1, 3, 1, Some(map)),
            Some(Coordinate { x: 7, y: 3, z: 1 })
        );
        assert_eq!(on_the_map(1, -1, 1, Some(map)), None);
        assert_eq!(on_the_map(1, 8, 1, Some(map)), None);
    }
}
