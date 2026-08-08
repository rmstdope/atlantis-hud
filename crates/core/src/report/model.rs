//! Domain model for a parsed NewOrigins turn report.
//!
//! This sits alongside the older flat summaries rather than replacing them, so the existing wire
//! types and panels keep working while the UI is rebuilt. Everything here is what the report
//! actually says; nothing is inferred.

use serde::{Deserialize, Serialize};

/// A hex, in the game's own coordinate space.
///
/// Levels are numbered from 1 at the surface. Only coordinates where `x + y` is even exist, which
/// is why the map is drawn with flat-top hexes: north and south are direct neighbours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coordinate {
    pub x: i32,
    pub y: i32,
    pub z: u32,
}

impl Coordinate {
    /// Canonical identifier, matching how the game writes a hex in an orders file.
    #[must_use]
    pub fn id(&self) -> String {
        format!("{}:{},{}", self.z, self.x, self.y)
    }
}

/// A quantity of one item, as in `57 grain [GRAI]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemAmount {
    pub amount: i64,
    pub name: String,
    pub tag: String,
}

/// An item offered or sought in a market, as in `138 grain [GRAI] at $24`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketItem {
    pub amount: i64,
    pub name: String,
    pub tag: String,
    pub price: i64,
}

/// A settlement inside a region, as in `contains Inholm [city]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    pub name: String,
    /// `village`, `town` or `city`.
    pub size: String,
}

/// One of the six neighbours named in a region's `Exits` block.
///
/// An exit names a region the faction may never have visited, which is what makes a third map
/// state necessary: known by name, with terrain and province but nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exit {
    pub direction: String,
    pub terrain: String,
    pub coordinate: Coordinate,
    pub province: String,
    pub settlement: Option<Settlement>,
}

/// A building, ship or road, as introduced by a `+` line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Structure {
    pub structure_id: String,
    pub name: String,
    /// `Fort`, `Caravanserai`, `Longship`, `Road N`, and so on.
    pub kind: String,
    pub description: Option<String>,
    /// Remaining build cost when the structure is unfinished.
    pub needs: Option<i64>,
}

/// A skill with its level and accumulated study points, as in `stealth [STEA] 5 (450)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub tag: String,
    pub level: u32,
    pub points: u32,
}

/// A unit as the report describes it.
///
/// Ownership comes from the report's own marker: `*` for your units, `-` for everyone else's. It is
/// never inferred, which is what makes the read-only rule for foreign units exact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportUnit {
    pub unit_id: String,
    pub name: String,
    pub region_id: String,
    /// Absent when a foreign unit conceals its faction.
    pub faction_id: Option<String>,
    pub faction_name: Option<String>,
    pub own: bool,
    pub on_guard: bool,
    pub flags: Vec<String>,
    pub items: Vec<ItemAmount>,
    pub skills: Vec<Skill>,
    /// Size of the unit's leading item group, which the game uses to open a unit's description.
    ///
    /// Not a true total when a unit contains more than one race: a report gives no marker
    /// separating men from equipment, so `50 leaders [LEAD], 20 nomads [NOMA], 30 swords [SWOR]`
    /// cannot be split without an item reference. A report does carry an `Item reports` section
    /// describing races, which would settle it, but that section is not parsed yet.
    pub men: i64,
    pub weight: Option<i64>,
    pub capacity: Option<String>,
    /// Set when the unit sits inside a structure.
    pub structure_id: Option<String>,
}

/// A region as the report describes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRegion {
    pub region_id: String,
    pub coordinate: Coordinate,
    pub terrain: String,
    pub province: String,
    pub settlement: Option<Settlement>,
    pub population: Option<i64>,
    /// Race of the peasants, when the region has any.
    pub race: Option<String>,
    /// The figure the game prints after the peasant count.
    pub tax_base: Option<i64>,
    pub wages: Option<String>,
    pub max_wages: Option<i64>,
    pub entertainment: Option<i64>,
    pub products: Vec<ItemAmount>,
    pub wanted: Vec<MarketItem>,
    pub for_sale: Vec<MarketItem>,
    pub exits: Vec<Exit>,
    pub structures: Vec<Structure>,
    pub units: Vec<ReportUnit>,
}

impl ReportRegion {
    /// How the region reads in the interface, for example `mountain (7,53) in Inhead`.
    #[must_use]
    pub fn label(&self) -> String {
        format!(
            "{} ({},{}) in {}",
            self.terrain, self.coordinate.x, self.coordinate.y, self.province
        )
    }
}
