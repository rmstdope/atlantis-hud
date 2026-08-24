//! Domain model for a parsed NewOrigins turn report.
//!
//! This sits alongside the older flat summaries rather than replacing them, so the existing wire
//! types and panels keep working while the UI is rebuilt. Everything here is what the report
//! actually says; nothing is inferred.

use serde::{Deserialize, Serialize};

/// A hex, in the game's own coordinate space.
///
/// `z` is the engine's own level index (see [`crate::report::level`]): the nexus is 0, the surface
/// 1, the underworld 2. Only coordinates where `x + y` is even exist, which is why the map is drawn
/// with flat-top hexes: north and south are direct neighbours.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Hash, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
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
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct ItemAmount {
    pub amount: i64,
    pub name: String,
    pub tag: String,
}

/// An item offered or sought in a market, as in `138 grain [GRAI] at $24`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct MarketItem {
    pub amount: i64,
    pub name: String,
    pub tag: String,
    pub price: i64,
}

/// A settlement inside a region, as in `contains Inholm [city]`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "SettlementInfo", export_to = "SettlementInfo.ts")
)]
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
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "RegionExit", export_to = "RegionExit.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct Exit {
    pub direction: String,
    pub terrain: String,
    pub coordinate: Coordinate,
    pub province: String,
    pub settlement: Option<Settlement>,
}

/// One vessel named inside a fleet's manifest: `40 Galleons`.
///
/// `count` is `None` where the report named a vessel without a number. The count is NOT assumed to
/// be one here, because whether an unnumbered vessel counts as one is the *reader's* question, and
/// `vesselCount` in the map layer already answers it its own way (`ah-nmts`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "VesselEntry", export_to = "VesselEntry.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct VesselEntry {
    pub count: Option<i64>,
    pub name: String,
}

/// A building, ship or road, as introduced by a `+` line.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "StructureInfo", export_to = "StructureInfo.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct Structure {
    pub structure_id: String,
    pub name: String,
    /// The kind as the report wrote it, qualifiers and all: `Galley, 40 Galleons, 11 Galleys`,
    /// `Lair, closed to player units`, `Fort`, `Road N`.
    ///
    /// Unchanged in meaning, and still what a player is shown - the three fields below are derived
    /// from it. A remembered hex is stored as this region's own JSON and read back as it was
    /// written, never re-parsed, so redefining this field would retroactively change what every
    /// stored snapshot says (`ah-nmts`).
    pub kind: String,
    /// The kind alone, before the first comma: `Galley`, `Lair`, `Road N`. Case as the report
    /// wrote it; a reader that matches on bare words lower-cases it itself.
    #[serde(default)]
    pub base_kind: String,
    /// Everything after the first comma, one trimmed clause per entry:
    /// `["closed to player units"]`. The `, needs N` clause is not among them - it is `needs`.
    #[serde(default)]
    pub qualifiers: Vec<String>,
    /// The qualifiers that name vessels, parsed. Empty for every structure that is not a fleet.
    #[serde(default)]
    pub vessels: Vec<VesselEntry>,
    pub description: Option<String>,
    /// Remaining build cost when the structure is unfinished.
    pub needs: Option<i64>,
}

/// A skill with its level and accumulated study points, as in `stealth [STEA] 5 (450)`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "SkillInfo", export_to = "SkillInfo.ts")
)]
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
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
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
    /// How many people the unit contains.
    ///
    /// Exact once the unit has been classified against the scraped item catalogue; until then it
    /// is the size of the leading item group, which is right for the common case and wrong for a
    /// unit holding two races. [`men_estimated`](Self::men_estimated) says which it is.
    pub men: i64,
    /// Whether [`men`](Self::men) is a guess rather than a count.
    ///
    /// True until `classify_units` has run against a catalogue that recognises everything the unit
    /// holds. A report writes a unit's people and its equipment as one undifferentiated list, so
    /// the two cannot be separated without an item reference.
    ///
    /// Defaults to true, which matters for payloads persisted before this field existed: those
    /// came from a build that could not classify at all, so the estimate is what they carry.
    #[serde(default = "estimated_until_classified")]
    pub men_estimated: bool,
    /// The unit's people, by race, once it has been classified. Empty while estimated.
    #[serde(default)]
    pub men_by_race: Vec<ItemAmount>,
    pub weight: Option<i64>,
    pub capacity: Option<String>,
    /// Set when the unit sits inside a structure.
    pub structure_id: Option<String>,
}

/// A unit that has not been through classification carries an estimate, so that is the default a
/// payload without the field gets.
fn estimated_until_classified() -> bool {
    true
}

/// A unit nobody has described yet: no people, nothing carried, and — like every payload written
/// before classification existed — an estimate rather than a count. Tests build from this with
/// struct update; production never does.
impl Default for ReportUnit {
    fn default() -> Self {
        Self {
            unit_id: String::new(),
            name: String::new(),
            region_id: String::new(),
            faction_id: None,
            faction_name: None,
            own: false,
            on_guard: false,
            flags: Vec::new(),
            items: Vec::new(),
            skills: Vec::new(),
            men: 0,
            men_estimated: true,
            men_by_race: Vec::new(),
            weight: None,
            capacity: None,
            structure_id: None,
        }
    }
}

/// A region as the report describes it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
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
        region_label(
            &self.terrain,
            self.coordinate.x,
            self.coordinate.y,
            &self.province,
        )
    }
}

/// The label a region is shown by: its terrain, coordinate and province, spelled the same way
/// whichever call built the region it comes from.
#[must_use]
pub fn region_label(terrain: &str, x: i32, y: i32, province: &str) -> String {
    format!("{terrain} ({x},{y}) in {province}")
}

/// What kind of record the parser failed to read. Fixed set; the shell renders one word per case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub enum UnreadableKind {
    Region,
    Unit,
    Structure,
    Battle,
    Attitude,
}

/// What a rejected region block took with it. Only ever `Some` for [`UnreadableKind::Region`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct LostBlock {
    /// Source lines after the block's own header line.
    pub further_lines: usize,
    /// How many of those carried a unit marker (`*` or `-`).
    pub units: usize,
}

/// One record the parser could not read, kept verbatim so the player can see what was lost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub struct UnreadableLine {
    pub kind: UnreadableKind,
    /// 1-based source line numbers, from `LogicalLine`. Equal when the record did not wrap.
    pub line_start: usize,
    pub line_end: usize,
    /// The joined logical line, exactly as the parser saw it.
    pub text: String,
    pub lost: Option<LostBlock>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_default_unit_is_estimated_until_classified() {
        let unit = ReportUnit::default();

        assert!(unit.men_estimated);
        assert!(unit.men_by_race.is_empty());
    }

    #[test]
    fn a_default_region_has_the_nexus_origin() {
        let region = ReportRegion::default();

        assert_eq!(region.coordinate, Coordinate { x: 0, y: 0, z: 0 });
        assert!(region.units.is_empty());
    }
}
