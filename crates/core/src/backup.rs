//! One game as one file: the backup document both platforms export and import.
//!
//! The desktop stores in SQLite and the web in IndexedDB, and each used to encode and decode this
//! document itself. Every rule about the file - its envelope, its version bounds, what a row must
//! carry, what an absent stamp means, the order tables are written in - lives here and nowhere
//! else; a store reads its rows and hands them over, or takes rows back and writes them.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::movement::graph::MapGeometry;

use crate::report::model::{CombatSpell, ItemAmount, ReportUnit, Skill};
use crate::report::sighting::{sighting_from_payload, RegionSighting};

pub const GAME_BACKUP_FORMAT: &str = "atlantis-hud-game-backup";
/// Version 2 numbers turns the engine's way, January of Year 1 being turn 1; version 1 numbered
/// every turn one lower, and is read through [`move_to_engine_turns`] (ah-m6pw).
pub const CURRENT_GAME_BACKUP_VERSION: u32 = 2;
/// Moved from core-persistence with the manifest types; `create_game`/`open_game` still check it.
pub const CURRENT_MANIFEST_VERSION: u32 = 1;

/// The dimensions configured for every level in a world.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "MapSizes", export_to = "MapSizes.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct MapSizes {
    pub levels: BTreeMap<String, MapSize>,
    pub wrap_x: bool,
    pub wrap_y: bool,
}

/// One configured level's dimensions. Wrapping belongs to [`MapSizes`], not a level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "MapSize", export_to = "MapSize.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct MapSize {
    pub width: i32,
    pub height: i32,
}

/// Game metadata stored in the game manifest and database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "GameMetadata", export_to = "GameMetadata.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadata {
    pub game_id: String,
    pub game_name: String,
    /// Which ruleset this game is played under, by identifier rather than by content.
    ///
    /// The rules themselves are a served file the shell hands to the core per call, so a game
    /// records which one it wants and nothing more. Storing the whole ruleset here would freeze a
    /// scrape into every game and make correcting a movement value a data migration.
    pub ruleset_id: String,
    /// Which faction in this game is the player's, or `None` for a game that has never had a report
    /// imported - and for every game written before this field existed, whose manifest simply has no
    /// such key. Set only when the player says so at an import (ah-do8.3); read when the game is
    /// reopened (ah-do8.2).
    #[serde(default)]
    #[cfg_attr(test, ts(optional = nullable))]
    pub active_faction_id: Option<String>,
    /// The map a game recorded before map levels existed - **read, never written** (ah-8nfe).
    ///
    /// `map_sizes` is the one record of a game's dimensions; the shape movement and the
    /// viewport plan on is derived from it by the shell. A game that predates levels kept its map
    /// here, and the shell still reads it as a surface-only configuration until the player's first
    /// sizes edit, which removes it. `skip_serializing_if` keeps an absent map absent on the way
    /// out: a `"map": null` written into an old game's manifest would be a claim nobody made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub map: Option<MapGeometry>,
    /// The independently configured dimensions for each map level: the one record of the map a
    /// game is played on. Absent when the game never said, so the ruleset's default is assumed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub map_sizes: Option<MapSizes>,
}

/// Logical report source stored in the game manifest and database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "ReportSourceRef", export_to = "ReportSourceRef.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct ReportSourceRef {
    pub source_id: String,
    pub label: String,
}

/// Game manifest contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "GameManifest", export_to = "GameManifest.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct GameManifest {
    pub manifest_version: u32,
    pub metadata: GameMetadata,
    pub report_sources: Vec<ReportSourceRef>,
    /// When the game was created, as an ISO 8601 string.
    pub created_at: String,
    /// When the game was last opened, as an ISO 8601 string.
    ///
    /// This is what decides which game reopens on the next launch, which is why it lives in each
    /// game's own manifest rather than in an index beside them: there is no second copy to fall
    /// out of step with the games it describes.
    pub last_opened_at: String,
}

/// The manifest a reset leaves behind: the game's identity, and nothing else.
///
/// Written field by field on purpose, *not* as `GameManifest { ..previous }`: a struct-update
/// expression carries every future field through a reset silently, and the next field added to a
/// manifest is exactly the one that should not survive. Both platforms carried their own copy of
/// this rule and their own copy of that warning, and the two had already drifted apart on
/// `manifest_version` (`ah-8z4y.1`).
///
/// What survives is the identity a player would recognise the game by - its id, its name and its
/// ruleset. What does not: the active faction, the map, the report sources, and the timestamps,
/// which are both set to `now` because a reset game is a new game in every way but its name.
#[must_use]
pub fn reset_manifest(previous: &GameManifest, now: &str) -> GameManifest {
    GameManifest {
        manifest_version: CURRENT_MANIFEST_VERSION,
        metadata: GameMetadata {
            game_id: previous.metadata.game_id.clone(),
            game_name: previous.metadata.game_name.clone(),
            ruleset_id: previous.metadata.ruleset_id.clone(),
            active_faction_id: None,
            map: None,
            map_sizes: None,
        },
        report_sources: Vec::new(),
        created_at: now.to_string(),
        last_opened_at: now.to_string(),
    }
}

/// One change that may be made to an existing game's manifest.
///
/// The list is the point: every edit either platform makes is a variant here, so a sixth is one
/// variant and one arm rather than a field assignment in Rust and an object spread in TypeScript
/// that have to be written in the same commit and are guaranteed only by a comment (`ah-8z4y.3.1`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "ManifestEdit", export_to = "ManifestEdit.ts")
)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum ManifestEdit {
    /// Stamped every time the game is opened. This is what decides which game reopens next launch.
    Opened(String),
    /// Which ruleset the game is played under, by identifier.
    Ruleset(String),
    /// All level sizes, with wrapping shared by every configured level. The only edit of a game's
    /// map: it also removes a pre-levels `map`, so one record answers the question from then on.
    /// `None` removes both keys, and the ruleset's default is assumed again.
    MapSizes(Option<MapSizes>),
    /// The game's display name. Trimming and validating it is the shell's, not this function's.
    Name(String),
    /// `None` for a game that has never had a report imported. Unlike the map, this one writes a
    /// `null` - deliberately, and there is a test for each.
    ActiveFaction(Option<String>),
}

/// Applies one edit. Every other field is left exactly as it was.
///
/// Unlike [`reset_manifest`] this does **not** touch `manifest_version`: an edit rewrites one
/// field of a document already in the current shape, while a reset rewrites the whole document.
/// Do not make the two consistent - there is a test named for it.
pub fn apply_manifest_edit(manifest: &mut GameManifest, edit: &ManifestEdit) {
    match edit {
        ManifestEdit::Opened(at) => manifest.last_opened_at = at.clone(),
        ManifestEdit::Ruleset(id) => manifest.metadata.ruleset_id = id.clone(),
        ManifestEdit::MapSizes(map_sizes) => {
            manifest.metadata.map = None;
            manifest.metadata.map_sizes = map_sizes.clone();
        }
        ManifestEdit::Name(name) => manifest.metadata.game_name = name.clone(),
        ManifestEdit::ActiveFaction(id) => manifest.metadata.active_faction_id = id.clone(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupImportedTurn {
    pub faction_id: String,
    pub turn_number: u32,
    pub raw_report: String,
    pub parsed_payload_json: String,
    pub warnings_payload_json: String,
    pub imported_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupOrderDraft {
    pub faction_id: String,
    pub turn_number: u32,
    pub order_text: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupRegionSighting {
    pub faction_id: String,
    pub region_id: String,
    pub last_seen_turn: u32,
    pub payload_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupMergedReport {
    pub faction_id: String,
    pub turn_number: u32,
    pub merged_faction_id: String,
    pub merged_faction_name: String,
    pub merged_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupHexNote {
    pub id: String,
    pub region_id: String,
    pub text: String,
    pub on_map: bool,
    pub turn: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// One player-written note on a hex, keyed by id; `region_id` is `Coordinate::id`'s `"z:x,y"`.
///
/// The stored row, which carries its game; `GameBackupHexNote` above is the same note inside a
/// backup document, where the game is the document's and so is not repeated per row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "HexNoteRecord", export_to = "HexNoteRecord.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct HexNote {
    pub id: String,
    pub game_id: String,
    pub region_id: String,
    pub text: String,
    pub on_map: bool,
    pub turn: u32,
    pub created_at: String,
    pub updated_at: String,
}

/// One unit as an Army remembers it: the last report that showed it, whichever turn that was.
///
/// A member the current report does not mention is kept and still exported - it may be another
/// faction's unit that is simply not visible this turn - so a membership carries a whole snapshot
/// rather than a unit number, and carries everything an export needs.
///
/// It lives here, rather than in `core-persistence`, because the backup carries it too and both
/// stores read it; `core-persistence` re-exports it, as it already does `GameManifest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "ArmyMemberRecord", export_to = "ArmyMemberRecord.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct ArmyMember {
    /// The report's unit number. The key: stable across turns, and never withheld.
    pub unit_id: String,
    pub name: String,
    /// `None` when the unit was concealing its faction when last seen.
    pub faction_id: Option<String>,
    pub faction_name: Option<String>,
    pub own: bool,
    /// Where it was when last seen; `Coordinate::id`'s `"z:x,y"`.
    pub region_id: String,
    pub flags: Vec<String>,
    pub items: Vec<ItemAmount>,
    pub skills: Vec<Skill>,
    /// The combat spell it was set to when last seen; `None` for a unit that has none, and for
    /// every member persisted before this field existed.
    #[serde(default)]
    pub combat_spell: Option<CombatSpell>,
    pub men: i64,
    /// The turn of the report this snapshot came from.
    pub seen_turn: u32,
    /// When the snapshot was taken, ISO 8601, from the caller's clock.
    pub seen_at: String,
}

/// One Army in a backup. The game is the document's, so it is not repeated per row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupArmy {
    pub id: String,
    pub name: String,
    pub members: Vec<ArmyMember>,
    pub created_at: String,
    pub updated_at: String,
}

/// A named group of units, scoped to the game and outliving any one turn.
///
/// The stored row, which carries its game; `GameBackupArmy` above is the same Army inside a backup
/// document, where the game is the document's and so is not repeated per row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "ArmyRecord", export_to = "ArmyRecord.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct Army {
    pub id: String,
    pub game_id: String,
    pub name: String,
    pub members: Vec<ArmyMember>,
    pub created_at: String,
    pub updated_at: String,
}

/// One mage an ally shared, as the sheet that carried him described him.
///
/// The unit is kept whole rather than flattened: the study planner reads an allied mage through
/// `standing_of`'s TypeScript counterpart, which takes a `ReportUnit`, so a narrower row would
/// need a conversion back and a second definition of what a mage is.
///
/// There is no `game_id`: every call that reads or writes these rows is scoped to one game and
/// takes it as a parameter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "AlliedMageRecord", export_to = "AlliedMageRecord.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct AlliedMage {
    /// The sending faction, from the sheet's own header - never from a unit line.
    pub faction_id: String,
    /// The sender's name from that header; `None` when the header carried an id and no name.
    pub faction_name: Option<String>,
    /// The parsed unit. Its `unit_id` is the row's key half; there is no second copy of it.
    pub unit: ReportUnit,
    /// The turn of the sheet this row came from. Staleness is this against the faction's newest.
    pub sheet_turn: u32,
    /// When the sheet was taken in, ISO 8601, from the caller's clock.
    pub received_at: String,
}

/// One stored mage's identity: which ally, and which unit of his.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "AlliedMageKey", export_to = "AlliedMageKey.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct AlliedMageKey {
    pub faction_id: String,
    pub unit_id: String,
}

/// One planned month: a month of study, or a month spent teaching.
///
/// A plan is one of these per planned turn - at most one for any turn, and turns with none are
/// simply unplanned. `rules/study`: `STUDY [skill]` is the bare one-month form, which is what a
/// planned month exports as - the two-argument `STUDY [skill] [level]` means "continue from turn to
/// turn until he reaches that level", which would override the turns the player planned by hand. `rules/teach`: `TEACH [unit] ...` names the units taught, and the
/// teacher studies nothing that month, so a teach goal is always exactly one month.
///
/// The per-variant `rename_all` rather than the container-level `rename_all_fields`: the latter
/// needs serde 1.0.181 or newer, and this crate has never declared a serde floor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "StudyGoal", export_to = "StudyGoal.ts")
)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StudyGoal {
    #[serde(rename_all = "camelCase")]
    Study {
        /// The game turn this month is planned for, as the report numbers turns.
        ///
        /// `#[serde(default)]`, and only for the rows written before ah-lyg6.2.3's redesign: a plan
        /// stored under the queue-of-goals shape names no turn, and reads back as turn 0, which the
        /// TypeScript reader drops. Nothing writes a 0.
        #[serde(default)]
        turn: u32,
        /// The skill tag, upper-cased (`"FORC"`).
        skill: String,
    },
    #[serde(rename_all = "camelCase")]
    Teach {
        /// The game turn this month is planned for, as the report numbers turns.
        #[serde(default)]
        turn: u32,
        /// The unit numbers taught, as the report writes them, in the order the player ticked them.
        ///
        /// Empty whenever `live` is true: a live cell stores no list, because the list is not a
        /// fact about the plan - it is recomputed from it.
        students: Vec<String>,
        /// True while the cell means "teach whoever is eligible this turn"; `students` is then empty,
        /// and the projection chooses the pupils on every render. Set to false the moment the player ticks or unticks anyone, from which point `students`
        /// is the whole answer.
        /// `#[serde(default)]` for every row written before ah-af7i, which is a fixed list.
        #[serde(default)]
        live: bool,
    },
}

/// One planned cast: the spell a mage casts (`rules/cast`) or sets for combat (`rules/combat`) on
/// one turn. Which of the two orders it stands for is the spell's `use` in the ruleset, not stored
/// here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "PlannedCast", export_to = "PlannedCast.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct PlannedCast {
    /// The game turn, as the report numbers turns.
    pub turn: u32,
    /// The spell's skill tag, upper-cased (`"FARS"`).
    pub spell: String,
}

/// One mage's study plan: one goal per planned turn, and what the player wants to remember.
///
/// There is no `game_id`: every call that reads or writes these rows is scoped to one game and
/// takes it as a parameter, exactly as `AlliedMage` is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "StudyPlanRecord", export_to = "StudyPlanRecord.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlan {
    /// Whose mage this is - the player's own faction, or an ally's, as `AlliedMage::faction_id`.
    pub faction_id: String,
    /// The unit number, as the report writes it.
    pub unit_id: String,
    /// One entry per planned turn, ascending by `turn`. Empty when the row is a note with nothing planned.
    #[serde(default)]
    pub goals: Vec<StudyGoal>,
    /// The spell he casts or readies for battle, one per planned turn, ascending by `turn`.
    ///
    /// A list of its own rather than a field of `StudyGoal`: `rules/magic_usingmagic` (New Age:
    /// Trident) says a CAST "is not a full month order", so a cast sits beside the month's study or
    /// teach - and on a turn that has neither, which a goal-borne cast could not.
    /// `#[serde(default)]` for every row written before ah-9qdz.2, which reads as no cast.
    #[serde(default)]
    pub casts: Vec<PlannedCast>,
    /// The player's free text. Never `None`: an absent note is the empty string.
    pub comment: String,
    /// When the row was last written, ISO 8601, from the caller's clock.
    pub updated_at: String,
}

/// One stored plan's identity: whose mage, and which unit of his.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, rename = "StudyPlanKey", export_to = "StudyPlanKey.ts")
)]
#[serde(rename_all = "camelCase")]
pub struct StudyPlanKey {
    pub faction_id: String,
    pub unit_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupCollections<ImportedTurn, RegionSighting> {
    pub imported_turns: Vec<ImportedTurn>,
    pub order_drafts: Vec<GameBackupOrderDraft>,
    pub region_sightings: Vec<RegionSighting>,
    pub merged_reports: Vec<GameBackupMergedReport>,
    #[serde(default)]
    pub hex_notes: Vec<GameBackupHexNote>,
    #[serde(default)]
    pub armies: Vec<GameBackupArmy>,
    #[serde(default)]
    pub allied_mages: Vec<AlliedMage>,
    #[serde(default)]
    pub study_plans: Vec<StudyPlan>,
}

pub type EncodedGameBackupCollections =
    GameBackupCollections<GameBackupImportedTurn, GameBackupRegionSighting>;
pub type DecodedGameBackupCollections =
    GameBackupCollections<DecodedImportedTurn, DecodedRegionSighting>;

/// The rows of one game, without the envelope: what a store hands over to be encoded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupContent {
    pub manifest: GameManifest,
    #[serde(flatten)]
    pub collections: EncodedGameBackupCollections,
}

/// The document as written: the envelope around the content. `#[serde(default)]` on
/// `exported_at` (a file written by hand may omit it; nothing reads it back), on `hex_notes`
/// (absent in a backup written before ah-o1t.1), on `armies` (absent in one written before
/// ah-1mpx.1), on `allied_mages` (absent in one written before ah-lyg6.1.2.1) and on
/// `study_plans` (absent in one written before ah-lyg6.2.1); such a backup still imports.
/// A `StudyPlan`'s `goals` carries `#[serde(default)]` for the same reason. There is no decode
/// path for the flat `skill`/`target_level` this row carried before ah-lyg6.2.3: ah-lyg6.2.1
/// merged as `21af4dc`, which is not an ancestor of the newest tag, so no released build ever
/// wrote a backup containing one. For the same reason a goal written before ah-lyg6.3 - carrying
/// no `kind` discriminant - has no decode path here either: it is rewritten by migration 0013 on
/// the desktop and by a read-path shim in the browser, and neither is a contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackup {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub exported_at: String,
    pub manifest: GameManifest,
    #[serde(flatten)]
    pub collections: EncodedGameBackupCollections,
}

/// One imported turn as a store writes it after a decode: both stamps resolved, never optional.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedImportedTurn {
    pub faction_id: String,
    pub turn_number: u32,
    pub raw_report: String,
    pub parsed_payload_json: String,
    pub warnings_payload_json: String,
    pub imported_at: String,
    pub updated_at: String,
}

/// One remembered region as a store writes it: the faction that saw it, and the full sighting
/// (coordinate, terrain, province, label, turn, payload) rebuilt from the payload - so the desktop
/// can fill its columns and the web can take `regionId`/`lastSeenTurn`/`payloadJson`, neither
/// reading the payload itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedRegionSighting {
    pub faction_id: String,
    #[serde(flatten)]
    pub sighting: RegionSighting,
}

/// What `decode_game_backup` hands a store: rows ready to write, and a manifest already stamped
/// with the opening time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedGameBackup {
    pub manifest: GameManifest,
    #[serde(flatten)]
    pub collections: DecodedGameBackupCollections,
}

#[derive(Debug)]
pub enum BackupError {
    /// The text is not JSON at all.
    NotJson,
    /// JSON, but `format` is missing or not ours.
    NotABackup,
    /// `version` is missing or not a number.
    NoVersion,
    /// `version` > `CURRENT_GAME_BACKUP_VERSION`.
    NewerVersion { actual: u32, max_supported: u32 },
    /// `version` < 1.
    UnsupportedVersion(u32),
    /// `manifest.manifestVersion` > `CURRENT_MANIFEST_VERSION`.
    UnsupportedManifestVersion { actual: u32, max_supported: u32 },
    /// Envelope was fine but the body is not the shape a backup has; carries serde's own message,
    /// which names the field and its position.
    Malformed(String),
    /// A remembered region whose payload cannot stand for it.
    InvalidSighting(String),
    /// `encode` could not serialise (never expected; carries serde's message).
    Unwritable(String),
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BackupError::NotJson => write!(f, "backup file is not valid JSON"),
            BackupError::NotABackup => write!(f, "backup file is not an Atlantis HUD game export"),
            BackupError::NoVersion => write!(f, "backup file does not say which version it is"),
            BackupError::NewerVersion {
                actual,
                max_supported,
            } => write!(
                f,
                "backup file format version {actual} is newer than this build supports ({max_supported})"
            ),
            BackupError::UnsupportedVersion(version) => {
                write!(f, "backup file format version {version} is not supported")
            }
            BackupError::UnsupportedManifestVersion {
                actual,
                max_supported,
            } => write!(
                f,
                "invalid game manifest version: expected <= {max_supported}, got {actual}"
            ),
            BackupError::Malformed(message) => {
                write!(f, "backup file could not be read: {message}")
            }
            BackupError::InvalidSighting(message) => {
                write!(f, "invalid game backup: {message}")
            }
            BackupError::Unwritable(message) => {
                write!(f, "backup could not be written: {message}")
            }
        }
    }
}

impl std::error::Error for BackupError {}

fn sort_key_turn(turn: &GameBackupImportedTurn) -> (String, u32) {
    (turn.faction_id.clone(), turn.turn_number)
}

fn sort_key_draft(draft: &GameBackupOrderDraft) -> (String, u32) {
    (draft.faction_id.clone(), draft.turn_number)
}

fn sort_key_sighting(sighting: &GameBackupRegionSighting) -> (String, String) {
    (sighting.faction_id.clone(), sighting.region_id.clone())
}

fn sort_key_merge(merge: &GameBackupMergedReport) -> (String, u32, String, String) {
    (
        merge.faction_id.clone(),
        merge.turn_number,
        merge.merged_at.clone(),
        merge.merged_faction_id.clone(),
    )
}

fn sort_key_note(note: &GameBackupHexNote) -> (String, String) {
    (note.created_at.clone(), note.id.clone())
}

fn sort_key_army(army: &GameBackupArmy) -> (String, String) {
    (army.name.clone(), army.id.clone())
}

fn sort_key_allied_mage(mage: &AlliedMage) -> (String, String) {
    (mage.faction_id.clone(), mage.unit.unit_id.clone())
}

fn sort_key_study_plan(plan: &StudyPlan) -> (String, String) {
    (plan.faction_id.clone(), plan.unit_id.clone())
}

/// One game -> one document. Sorts every table so two exports of the same game are byte-identical
/// whichever platform wrote them: turns by (faction_id, turn_number); drafts by (faction_id,
/// turn_number); sightings by (faction_id, region_id); merged reports by (faction_id,
/// turn_number, merged_at, merged_faction_id); hex notes by (created_at, id) - the same keys the
/// desktop's five ORDER BYs used; Armies by (name, id), which is `sortArmies`' order; and allied
/// mages by (faction_id, unit.unit_id), which is `sortAlliedMages`' order; and study plans by
/// (faction_id, unit_id), which is `sortStudyPlans`' order.
/// Pretty-printed with two-space indent.
pub fn encode_game_backup(
    content: GameBackupContent,
    exported_at: &str,
) -> Result<String, BackupError> {
    let GameBackupContent {
        manifest,
        collections,
    } = content;
    let GameBackupCollections {
        mut imported_turns,
        mut order_drafts,
        mut region_sightings,
        mut merged_reports,
        mut hex_notes,
        mut armies,
        mut allied_mages,
        mut study_plans,
    } = collections;

    imported_turns.sort_by_key(sort_key_turn);
    order_drafts.sort_by_key(sort_key_draft);
    region_sightings.sort_by_key(sort_key_sighting);
    merged_reports.sort_by_key(sort_key_merge);
    hex_notes.sort_by_key(sort_key_note);
    armies.sort_by_key(sort_key_army);
    allied_mages.sort_by_key(sort_key_allied_mage);
    study_plans.sort_by_key(sort_key_study_plan);

    let backup = GameBackup {
        format: GAME_BACKUP_FORMAT.to_string(),
        version: CURRENT_GAME_BACKUP_VERSION,
        exported_at: exported_at.to_string(),
        manifest,
        collections: GameBackupCollections {
            imported_turns,
            order_drafts,
            region_sightings,
            merged_reports,
            hex_notes,
            armies,
            allied_mages,
            study_plans,
        },
    };

    serde_json::to_string_pretty(&backup)
        .map_err(|error| BackupError::Unwritable(error.to_string()))
}

/// The wasm-facing twin: the content arrives as JSON text (a store's own records, serialised as
/// they are). Deserialised as `GameBackupContent`, which is what makes it lenient - serde ignores
/// keys it does not know (`databasePath`, `gameId`, anything a store keeps beside the wire fields)
/// and reads an absent `importedAt`/`updatedAt` as `None`. Then `encode_game_backup`.
pub fn encode_game_backup_json(
    content_json: &str,
    exported_at: &str,
) -> Result<String, BackupError> {
    let content: GameBackupContent = serde_json::from_str(content_json)
        .map_err(|error| BackupError::Malformed(error.to_string()))?;
    encode_game_backup(content, exported_at)
}

/// Moves every turn a version-1 backup names up by one.
///
/// Version 1 was written while `turn_number_for` called February of Year 1 turn 1; the engine's
/// `Game::TurnNumber` (game.cpp) makes January of Year 1 turn 1, so every turn in such a backup is
/// one low. This is the move migration 15 makes to a stored desktop game, applied to the file
/// instead, so both stores and both platforms restore one backup alike. A goal's turn 0 marks a goal
/// written before goals had turns, which every reader drops, so it stays; a cast has no such form.
fn move_to_engine_turns(collections: &mut EncodedGameBackupCollections) {
    let later = |turn: &mut u32| *turn = turn.saturating_add(1);

    for turn in &mut collections.imported_turns {
        later(&mut turn.turn_number);
        // Through the typed result, so the payload comes back in the shape an import writes. A
        // payload that does not read is left alone: it is only ever consulted for its season and
        // to compare against a re-import.
        if let Ok(mut parsed) =
            serde_json::from_str::<crate::ReportParseResult>(&turn.parsed_payload_json)
        {
            if let Some(header) = parsed.turn_header.as_mut() {
                later(&mut header.turn_number);
            }
            if let Ok(json) = serde_json::to_string(&parsed) {
                turn.parsed_payload_json = json;
            }
        }
    }
    for draft in &mut collections.order_drafts {
        later(&mut draft.turn_number);
    }
    for sighting in &mut collections.region_sightings {
        later(&mut sighting.last_seen_turn);
    }
    for merge in &mut collections.merged_reports {
        later(&mut merge.turn_number);
    }
    for note in &mut collections.hex_notes {
        later(&mut note.turn);
    }
    for member in collections
        .armies
        .iter_mut()
        .flat_map(|army| army.members.iter_mut())
    {
        later(&mut member.seen_turn);
    }
    for mage in &mut collections.allied_mages {
        later(&mut mage.sheet_turn);
    }
    for plan in &mut collections.study_plans {
        for goal in &mut plan.goals {
            let (StudyGoal::Study { turn, .. } | StudyGoal::Teach { turn, .. }) = goal;
            if *turn > 0 {
                later(turn);
            }
        }
        // A cast has no turnless form, so a cast on turn 0 (January of Year 1, as version 1
        // counted) moves like any other.
        for cast in &mut plan.casts {
            later(&mut cast.turn);
        }
    }
}

/// Caps every sighting of a faction holding an AtlaClient merge at that faction's newest imported
/// turn (ah-vtgk).
///
/// AtlaClient stamps a hex with the engine's turn while version 1 numbered HUD's own turns one
/// lower, so a hex merged from AtlaClient on the newest turn was stored one turn too new, and
/// [`move_to_engine_turns`] keeps that difference. Nothing records which sighting came from
/// AtlaClient, so the repair is the bound that always holds: no sighting is newer than the newest
/// report of the faction it is filed under. Migration 16 makes the same repair to a stored desktop
/// game, and `engineTurns.ts` to a browser one.
fn cap_atlaclient_sightings(collections: &mut EncodedGameBackupCollections) {
    let merged_from_atlaclient: std::collections::BTreeSet<&str> = collections
        .merged_reports
        .iter()
        .filter(|merge| merge.merged_faction_id == crate::report::atlaclient::ATLACLIENT_SOURCE_ID)
        .map(|merge| merge.faction_id.as_str())
        .collect();
    let mut newest: std::collections::BTreeMap<String, u32> = std::collections::BTreeMap::new();
    for turn in &collections.imported_turns {
        if merged_from_atlaclient.contains(turn.faction_id.as_str()) {
            let entry = newest.entry(turn.faction_id.clone()).or_insert(0);
            *entry = (*entry).max(turn.turn_number);
        }
    }
    for sighting in &mut collections.region_sightings {
        if let Some(&cap) = newest.get(&sighting.faction_id) {
            sighting.last_seen_turn = sighting.last_seen_turn.min(cap);
        }
    }
}

/// One document -> rows to write. Two-stage on purpose: the envelope (`format`, `version`) is read
/// from a `serde_json::Value` and judged FIRST, so a file that is not a backup, or is from a newer
/// version, says so even when its body is also missing fields. Only then is the Value turned into a
/// `GameBackup`.
pub fn decode_game_backup(
    backup_json: &str,
    opened_at: &str,
) -> Result<DecodedGameBackup, BackupError> {
    let value: serde_json::Value =
        serde_json::from_str(backup_json).map_err(|_| BackupError::NotJson)?;

    let format = value.get("format").and_then(serde_json::Value::as_str);
    if format != Some(GAME_BACKUP_FORMAT) {
        return Err(BackupError::NotABackup);
    }

    let version = match value.get("version").and_then(serde_json::Value::as_u64) {
        Some(version) => version,
        None => return Err(BackupError::NoVersion),
    };
    // Compared as `u64` before narrowing: a version too large for `u32` must still be judged
    // "newer than this build supports" rather than truncating and wrapping into a value that
    // passes the check below.
    if version > u64::from(CURRENT_GAME_BACKUP_VERSION) {
        return Err(BackupError::NewerVersion {
            actual: u32::try_from(version).unwrap_or(u32::MAX),
            max_supported: CURRENT_GAME_BACKUP_VERSION,
        });
    }
    // Fits in `u32`: it has just been shown to be `<= CURRENT_GAME_BACKUP_VERSION`.
    let version = u32::try_from(version).unwrap_or(u32::MAX);
    if version < 1 {
        return Err(BackupError::UnsupportedVersion(version));
    }

    let backup: GameBackup =
        serde_json::from_value(value).map_err(|error| BackupError::Malformed(error.to_string()))?;

    if backup.manifest.manifest_version > CURRENT_MANIFEST_VERSION {
        return Err(BackupError::UnsupportedManifestVersion {
            actual: backup.manifest.manifest_version,
            max_supported: CURRENT_MANIFEST_VERSION,
        });
    }

    let GameBackup {
        format: _,
        version: _,
        exported_at: _,
        mut manifest,
        mut collections,
    } = backup;
    if version < 2 {
        move_to_engine_turns(&mut collections);
        cap_atlaclient_sightings(&mut collections);
    }
    let created_at = manifest.created_at.clone();
    manifest.last_opened_at = opened_at.to_string();
    let GameBackupCollections {
        imported_turns: encoded_imported_turns,
        order_drafts,
        region_sightings: encoded_region_sightings,
        merged_reports,
        hex_notes,
        armies,
        allied_mages,
        study_plans,
    } = collections;
    let imported_turns = encoded_imported_turns
        .into_iter()
        .map(|turn| {
            let imported_at = turn
                .imported_at
                .clone()
                .unwrap_or_else(|| created_at.clone());
            let updated_at = turn
                .updated_at
                .clone()
                .unwrap_or_else(|| imported_at.clone());
            DecodedImportedTurn {
                faction_id: turn.faction_id,
                turn_number: turn.turn_number,
                raw_report: turn.raw_report,
                parsed_payload_json: turn.parsed_payload_json,
                warnings_payload_json: turn.warnings_payload_json,
                imported_at,
                updated_at,
            }
        })
        .collect();

    let region_sightings = encoded_region_sightings
        .into_iter()
        .map(|sighting| {
            let rebuilt = sighting_from_payload(
                &sighting.region_id,
                sighting.last_seen_turn,
                &sighting.payload_json,
            )
            .map_err(BackupError::InvalidSighting)?;
            Ok(DecodedRegionSighting {
                faction_id: sighting.faction_id,
                sighting: rebuilt,
            })
        })
        .collect::<Result<Vec<_>, BackupError>>()?;

    Ok(DecodedGameBackup {
        manifest,
        collections: GameBackupCollections {
            imported_turns,
            order_drafts,
            region_sightings,
            merged_reports,
            hex_notes,
            armies,
            allied_mages,
            study_plans,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// The wire contract the generated TypeScript mirrors (ah-8z4y.2): an unstated map leaves *no*
    /// key, so "never said" cannot be read back as "said nothing", while an unstated active faction
    /// really does write `null` - which is why the two fields carry different ts-rs attributes.
    #[test]
    fn an_unstated_map_leaves_no_key_and_an_unstated_faction_writes_null() {
        let json = serde_json::to_value(manifest().metadata).expect("serialises");
        let object = json.as_object().expect("an object");

        assert!(!object.contains_key("map"), "got {object:?}");
        assert_eq!(
            object.get("activeFactionId"),
            Some(&serde_json::Value::Null)
        );

        let round_tripped: GameMetadata = serde_json::from_value(json).expect("reads back");
        assert_eq!(round_tripped, manifest().metadata);
    }

    #[test]
    fn a_reset_keeps_the_games_identity() {
        let fresh = reset_manifest(&manifest(), "2026-02-02T00:00:00Z");

        assert_eq!(fresh.metadata.game_id, "g1");
        assert_eq!(fresh.metadata.game_name, "Game One");
        assert_eq!(fresh.metadata.ruleset_id, "newOrigins");
    }

    #[test]
    fn a_reset_forgets_the_faction_the_map_and_the_sources() {
        let mut previous = manifest();
        previous.metadata.active_faction_id = Some("f1".to_string());
        previous.metadata.map = Some(MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
            levels: None,
        });
        previous.report_sources = vec![ReportSourceRef {
            source_id: "s1".to_string(),
            label: "turn 1".to_string(),
        }];

        let fresh = reset_manifest(&previous, "2026-02-02T00:00:00Z");

        assert_eq!(fresh.metadata.active_faction_id, None);
        assert_eq!(fresh.metadata.map, None);
        assert!(fresh.report_sources.is_empty());
    }

    #[test]
    fn a_reset_stamps_the_current_manifest_version() {
        let mut previous = manifest();
        previous.manifest_version = 0;

        let fresh = reset_manifest(&previous, "2026-02-02T00:00:00Z");

        assert_eq!(fresh.manifest_version, CURRENT_MANIFEST_VERSION);
    }

    #[test]
    fn a_reset_sets_both_timestamps_to_now() {
        let fresh = reset_manifest(&manifest(), "2026-02-02T00:00:00Z");

        assert_eq!(fresh.created_at, "2026-02-02T00:00:00Z");
        assert_eq!(fresh.last_opened_at, "2026-02-02T00:00:00Z");
    }

    #[test]
    fn an_edit_changes_one_field_and_nothing_else() {
        let mut edited = manifest();

        apply_manifest_edit(&mut edited, &ManifestEdit::Name("Renamed".to_string()));

        assert_eq!(edited.metadata.game_name, "Renamed");
        let mut expected = manifest();
        expected.metadata.game_name = "Renamed".to_string();
        assert_eq!(edited, expected);
    }

    /// The difference from `reset_manifest`: an edit rewrites one field of a document that is
    /// already in the current shape, so it never restamps the version.
    #[test]
    fn an_edit_does_not_touch_the_manifest_version() {
        let mut edited = manifest();
        edited.manifest_version = 0;

        apply_manifest_edit(&mut edited, &ManifestEdit::Name("Renamed".to_string()));

        assert_eq!(edited.manifest_version, 0);
    }

    #[test]
    fn an_edit_stamps_the_open_and_sets_the_ruleset() {
        let mut edited = manifest();

        apply_manifest_edit(
            &mut edited,
            &ManifestEdit::Opened("2026-03-03T00:00:00Z".to_string()),
        );
        apply_manifest_edit(&mut edited, &ManifestEdit::Ruleset("standard".to_string()));

        assert_eq!(edited.last_opened_at, "2026-03-03T00:00:00Z");
        assert_eq!(edited.metadata.ruleset_id, "standard");
    }

    fn legacy_map() -> MapGeometry {
        MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
            levels: None,
        }
    }

    fn two_level_sizes() -> MapSizes {
        MapSizes {
            levels: BTreeMap::from([
                (
                    "surface".to_string(),
                    MapSize {
                        width: 40,
                        height: 60,
                    },
                ),
                (
                    "underworld".to_string(),
                    MapSize {
                        width: 48,
                        height: 48,
                    },
                ),
            ]),
            wrap_x: true,
            wrap_y: false,
        }
    }

    /// The sizes are the one record (ah-8nfe): the shape the map is drawn on is derived from them
    /// where it is needed, so the edit writes nothing else, and a pre-levels game's `map` goes on
    /// the first edit rather than lingering as a second answer to the same question.
    #[test]
    fn setting_map_sizes_records_only_the_sizes() {
        let mut edited = manifest();
        edited.metadata.map = Some(legacy_map());

        apply_manifest_edit(
            &mut edited,
            &ManifestEdit::MapSizes(Some(two_level_sizes())),
        );

        assert_eq!(edited.metadata.map_sizes, Some(two_level_sizes()));
        let json = serde_json::to_value(&edited.metadata).expect("serialises");
        let object = json.as_object().expect("an object");
        assert!(!object.contains_key("map"), "got {object:?}");
    }

    /// Cleared sizes leave nothing behind - not even a legacy map, which a reader would otherwise
    /// take as this game's own word.
    #[test]
    fn clearing_map_sizes_leaves_no_map_at_all() {
        let mut edited = manifest();
        edited.metadata.map = Some(legacy_map());
        edited.metadata.map_sizes = Some(two_level_sizes());

        apply_manifest_edit(&mut edited, &ManifestEdit::MapSizes(None));

        let json = serde_json::to_value(&edited.metadata).expect("serialises");
        let object = json.as_object().expect("an object");
        assert!(!object.contains_key("map"), "got {object:?}");
        assert!(!object.contains_key("mapSizes"), "got {object:?}");
    }

    /// The mirror of the map: an unstated faction really does write `null`, and the two must not
    /// be "harmonised" - the settings dialog reads the difference.
    #[test]
    fn clearing_the_active_faction_records_the_absence() {
        let mut edited = manifest();
        edited.metadata.active_faction_id = Some("f1".to_string());

        apply_manifest_edit(&mut edited, &ManifestEdit::ActiveFaction(None));

        let json = serde_json::to_value(&edited.metadata).expect("serialises");
        assert_eq!(
            json.as_object().expect("an object").get("activeFactionId"),
            Some(&serde_json::Value::Null)
        );
    }

    #[test]
    fn setting_the_active_faction_records_it() {
        let mut edited = manifest();

        apply_manifest_edit(
            &mut edited,
            &ManifestEdit::ActiveFaction(Some("f2".to_string())),
        );

        assert_eq!(edited.metadata.active_faction_id, Some("f2".to_string()));
    }

    fn manifest() -> GameManifest {
        GameManifest {
            manifest_version: 1,
            metadata: GameMetadata {
                game_id: "g1".to_string(),
                game_name: "Game One".to_string(),
                ruleset_id: "newOrigins".to_string(),
                active_faction_id: None,
                map: None,
                map_sizes: None,
            },
            report_sources: vec![],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            last_opened_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn sighting_payload() -> String {
        serde_json::json!({
            "regionId": "1:7,53",
            "coordinate": { "x": 7, "y": 53, "z": 1 },
            "terrain": "plain",
            "province": "Inhead"
        })
        .to_string()
    }

    fn content_with(
        turns: Vec<GameBackupImportedTurn>,
        drafts: Vec<GameBackupOrderDraft>,
        sightings: Vec<GameBackupRegionSighting>,
        merges: Vec<GameBackupMergedReport>,
        notes: Vec<GameBackupHexNote>,
    ) -> GameBackupContent {
        GameBackupContent {
            manifest: manifest(),
            collections: EncodedGameBackupCollections {
                imported_turns: turns,
                order_drafts: drafts,
                region_sightings: sightings,
                merged_reports: merges,
                hex_notes: notes,
                armies: vec![],
                allied_mages: vec![],
                study_plans: vec![],
            },
        }
    }

    #[test]
    fn an_army_round_trips_as_camel_case() {
        let army = Army {
            id: "army-1".to_string(),
            game_id: "faction-12".to_string(),
            name: "Northern escort".to_string(),
            members: vec![ArmyMember {
                unit_id: "204".to_string(),
                name: "Pikes".to_string(),
                faction_id: None,
                faction_name: None,
                own: false,
                region_id: "1:7,53".to_string(),
                flags: vec!["behind".to_string()],
                items: vec![],
                skills: vec![],
                combat_spell: None,
                men: 12,
                seen_turn: 68,
                seen_at: "2026-08-07T12:00:00Z".to_string(),
            }],
            created_at: "2026-08-07T12:00:00Z".to_string(),
            updated_at: "2026-08-07T12:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&army).expect("serialises");

        assert!(json.contains("\"gameId\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"updatedAt\""));
        assert!(json.contains("\"unitId\""));
        assert!(json.contains("\"factionId\""));
        assert!(json.contains("\"factionName\""));
        assert!(json.contains("\"regionId\""));
        assert!(json.contains("\"combatSpell\""));
        assert!(json.contains("\"seenTurn\""));
        assert!(json.contains("\"seenAt\""));
        assert_eq!(
            serde_json::from_str::<Army>(&json).expect("round trips"),
            army
        );
    }

    #[test]
    fn a_hex_note_round_trips_as_camel_case() {
        let note = HexNote {
            id: "note-1".to_string(),
            game_id: "faction-12".to_string(),
            region_id: "1:7,53".to_string(),
            text: "Mustn't forget the mountain pass".to_string(),
            on_map: true,
            turn: 12,
            created_at: "2026-08-07T12:00:00Z".to_string(),
            updated_at: "2026-08-07T12:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&note).expect("serialises");

        assert!(json.contains("\"gameId\""));
        assert!(json.contains("\"regionId\""));
        assert!(json.contains("\"onMap\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"updatedAt\""));
        assert_eq!(
            serde_json::from_str::<HexNote>(&json).expect("round trips"),
            note
        );
    }

    #[test]
    fn the_manifest_round_trips_as_camel_case() {
        let json = serde_json::to_string(&manifest()).expect("serialises");

        assert!(json.contains("\"manifestVersion\""));
        assert!(json.contains("\"reportSources\""));
        assert!(json.contains("\"createdAt\""));
        assert!(json.contains("\"lastOpenedAt\""));
    }

    #[test]
    fn encode_writes_the_envelope_and_sorts_every_table() {
        let turn_b = GameBackupImportedTurn {
            faction_id: "2".to_string(),
            turn_number: 1,
            raw_report: "b".to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
            imported_at: Some("2026-01-02T00:00:00Z".to_string()),
            updated_at: Some("2026-01-02T00:00:00Z".to_string()),
        };
        let turn_a = GameBackupImportedTurn {
            faction_id: "1".to_string(),
            turn_number: 1,
            raw_report: "a".to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
            imported_at: Some("2026-01-02T00:00:00Z".to_string()),
            updated_at: Some("2026-01-02T00:00:00Z".to_string()),
        };

        let content = content_with(vec![turn_b, turn_a], vec![], vec![], vec![], vec![]);

        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        assert!(encoded.contains("\"format\": \"atlantis-hud-game-backup\""));
        assert!(encoded.contains("\"version\": 2"));
        assert!(encoded.contains("\"exportedAt\": \"2026-01-03T00:00:00Z\""));
        let a_pos = encoded
            .find("\"factionId\": \"1\"")
            .expect("faction 1 present");
        let b_pos = encoded
            .find("\"factionId\": \"2\"")
            .expect("faction 2 present");
        assert!(a_pos < b_pos, "turns should be sorted by faction id");
    }

    #[test]
    fn backup_collections_stay_flattened_in_the_backup_document() {
        let content = content_with(vec![], vec![], vec![], vec![], vec![]);
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");
        let value: serde_json::Value = serde_json::from_str(&encoded).expect("valid JSON");
        let object = value.as_object().expect("object");

        for key in [
            "importedTurns",
            "orderDrafts",
            "regionSightings",
            "mergedReports",
            "hexNotes",
            "armies",
            "alliedMages",
            "studyPlans",
        ] {
            assert!(object.contains_key(key), "missing flattened key {key}");
        }
        assert!(!object.contains_key("collections"));
        assert_eq!(object.get("version"), Some(&serde_json::json!(2)));

        let mut old_value = value;
        let old_object = old_value.as_object_mut().expect("object");
        old_object.remove("hexNotes");
        old_object.remove("armies");
        old_object.remove("alliedMages");
        old_object.remove("studyPlans");
        let decoded = decode_game_backup(
            &serde_json::to_string(&old_value).expect("serializes"),
            "2026-01-07T00:00:00Z",
        )
        .expect("old backup decodes");
        assert!(decoded.collections.hex_notes.is_empty());
        assert!(decoded.collections.armies.is_empty());
        assert!(decoded.collections.allied_mages.is_empty());
        assert!(decoded.collections.study_plans.is_empty());
    }

    #[test]
    fn encode_from_json_ignores_keys_a_store_keeps_beside_the_wire_fields() {
        let content_json = serde_json::json!({
            "manifest": manifest(),
            "importedTurns": [{
                "factionId": "1",
                "turnNumber": 1,
                "rawReport": "r",
                "parsedPayloadJson": "{}",
                "warningsPayloadJson": "[]",
                "databasePath": "/tmp/db",
                "gameId": "g1"
            }],
            "orderDrafts": [],
            "regionSightings": [],
            "mergedReports": [],
            "hexNotes": []
        })
        .to_string();

        let encoded = encode_game_backup_json(&content_json, "2026-01-03T00:00:00Z")
            .expect("encodes leniently");

        assert!(encoded.contains("\"importedAt\": null"));
    }

    #[test]
    fn decode_refuses_text_that_is_not_json() {
        let error = decode_game_backup("not json", "2026-01-01T00:00:00Z").unwrap_err();

        assert!(matches!(error, BackupError::NotJson));
        assert_eq!(error.to_string(), "backup file is not valid JSON");
    }

    #[test]
    fn decode_refuses_json_that_is_not_a_backup() {
        let error = decode_game_backup("{\"a\":1}", "2026-01-01T00:00:00Z").unwrap_err();

        assert!(matches!(error, BackupError::NotABackup));
        assert_eq!(
            error.to_string(),
            "backup file is not an Atlantis HUD game export"
        );
    }

    #[test]
    fn decode_judges_the_version_before_the_body() {
        let json = serde_json::json!({
            "format": GAME_BACKUP_FORMAT,
            "version": 99
        })
        .to_string();

        let error = decode_game_backup(&json, "2026-01-01T00:00:00Z").unwrap_err();

        assert!(error
            .to_string()
            .contains("newer than this build supports (2)"));
    }

    #[test]
    fn decode_refuses_version_zero() {
        let json = serde_json::json!({
            "format": GAME_BACKUP_FORMAT,
            "version": 0
        })
        .to_string();

        let error = decode_game_backup(&json, "2026-01-01T00:00:00Z").unwrap_err();

        assert!(matches!(error, BackupError::UnsupportedVersion(0)));
    }

    #[test]
    fn decode_names_the_field_a_malformed_body_lacks() {
        let json = serde_json::json!({
            "format": GAME_BACKUP_FORMAT,
            "version": 1,
            "manifest": manifest()
        })
        .to_string();

        let error = decode_game_backup(&json, "2026-01-01T00:00:00Z").unwrap_err();
        let message = error.to_string();

        assert!(message.starts_with("backup file could not be read: "));
        assert!(message.contains("importedTurns"));
    }

    #[test]
    fn decode_tolerates_a_missing_hex_notes_key_and_a_missing_exported_at() {
        let json = serde_json::json!({
            "format": GAME_BACKUP_FORMAT,
            "version": 1,
            "manifest": manifest(),
            "importedTurns": [],
            "orderDrafts": [],
            "regionSightings": [],
            "mergedReports": []
        })
        .to_string();

        let decoded = decode_game_backup(&json, "2026-01-01T00:00:00Z").expect("decodes");

        assert!(decoded.collections.hex_notes.is_empty());
    }

    #[test]
    fn a_backup_written_before_armies_still_decodes() {
        let json = serde_json::json!({
            "format": GAME_BACKUP_FORMAT,
            "version": 1,
            "exportedAt": "2026-01-01T00:00:00Z",
            "manifest": manifest(),
            "importedTurns": [],
            "orderDrafts": [],
            "regionSightings": [],
            "mergedReports": [],
            "hexNotes": []
        })
        .to_string();

        let decoded = decode_game_backup(&json, "2026-01-01T00:00:00Z").expect("decodes");

        assert!(decoded.collections.armies.is_empty());
    }

    #[test]
    fn a_member_persisted_before_combat_spells_reads_back_without_one() {
        // The whole no-migration argument: `members_json` is one serde blob, so a blob written
        // before this field existed must still deserialise, with `None` for the spell.
        let json = serde_json::json!({
            "unitId": "204",
            "name": "Pikes",
            "factionId": null,
            "factionName": null,
            "own": false,
            "regionId": "1:7,53",
            "flags": [],
            "items": [],
            "skills": [],
            "men": 12,
            "seenTurn": 68,
            "seenAt": "2026-01-05T00:00:00Z"
        })
        .to_string();

        let member: ArmyMember = serde_json::from_str(&json).expect("decodes");

        assert_eq!(member.combat_spell, None);
        assert_eq!(member.unit_id, "204");
    }

    #[test]
    fn armies_survive_encode_and_decode() {
        let army = GameBackupArmy {
            id: "army-1".to_string(),
            name: "Northern escort".to_string(),
            members: vec![ArmyMember {
                unit_id: "204".to_string(),
                name: "Pikes".to_string(),
                faction_id: None,
                faction_name: None,
                own: false,
                region_id: "1:7,53".to_string(),
                flags: vec!["behind".to_string()],
                items: vec![ItemAmount {
                    amount: 57,
                    name: "grain".to_string(),
                    tag: "GRAI".to_string(),
                    needs: None,
                }],
                skills: vec![Skill {
                    name: "combat".to_string(),
                    tag: "COMB".to_string(),
                    level: 2,
                    points: 90,
                }],
                combat_spell: Some(CombatSpell {
                    name: "fire".to_string(),
                    tag: "FIRE".to_string(),
                }),
                men: 12,
                seen_turn: 68,
                seen_at: "2026-01-05T00:00:00Z".to_string(),
            }],
            created_at: "2026-01-05T00:00:00Z".to_string(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let mut content = content_with(vec![], vec![], vec![], vec![], vec![]);
        content.collections.armies = vec![army.clone()];
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.collections.armies,
            vec![army],
            "a concealed faction stays None, and items and skills come back whole"
        );
    }

    #[test]
    fn allied_mages_survive_encode_and_decode() {
        let mage = AlliedMage {
            faction_id: "21".to_string(),
            faction_name: Some("Borg".to_string()),
            unit: ReportUnit {
                unit_id: "9001".to_string(),
                name: "Sweep Mage".to_string(),
                region_id: "1:7,53".to_string(),
                faction_id: Some("21".to_string()),
                faction_name: Some("Borg".to_string()),
                own: false,
                on_guard: false,
                flags: vec![],
                items: vec![ItemAmount {
                    amount: 1,
                    name: "leader".to_string(),
                    tag: "LEAD".to_string(),
                    needs: None,
                }],
                skills: vec![Skill {
                    name: "force".to_string(),
                    tag: "FORC".to_string(),
                    level: 3,
                    points: 180,
                }],
                combat_spell: Some(CombatSpell {
                    name: "fire".to_string(),
                    tag: "FIRE".to_string(),
                }),
                men: 1,
                men_estimated: true,
                men_by_race: vec![],
                weight: None,
                capacity: None,
                movement: None,
                structure_id: None,
                ..ReportUnit::default()
            },
            sheet_turn: 23,
            received_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let mut content = content_with(vec![], vec![], vec![], vec![], vec![]);
        content.collections.allied_mages = vec![mage.clone()];
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.collections.allied_mages,
            vec![mage],
            "the whole parsed unit comes back, skills and combat spell included"
        );
    }

    #[test]
    fn study_plans_survive_encode_and_decode() {
        let plan = StudyPlan {
            faction_id: "21".to_string(),
            unit_id: "9001".to_string(),
            goals: vec![
                StudyGoal::Study {
                    turn: 25,
                    skill: "FORC".to_string(),
                },
                StudyGoal::Study {
                    turn: 26,
                    skill: "PATT".to_string(),
                },
            ],
            casts: vec![],
            comment: "heading for Gate Lore".to_string(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let note_only = StudyPlan {
            faction_id: "21".to_string(),
            unit_id: "9002".to_string(),
            goals: vec![],
            casts: vec![],
            comment: String::new(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let mut content = content_with(vec![], vec![], vec![], vec![], vec![]);
        content.collections.study_plans = vec![note_only.clone(), plan.clone()];
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.collections.study_plans,
            vec![plan, note_only],
            "plans come back whole, sorted by (faction_id, unit_id)"
        );
    }

    #[test]
    fn a_teach_goal_survives_encode_and_decode() {
        let plan = StudyPlan {
            faction_id: "21".to_string(),
            unit_id: "9001".to_string(),
            goals: vec![
                StudyGoal::Teach {
                    turn: 25,
                    students: vec!["2517".to_string(), "2688".to_string()],
                    live: false,
                },
                StudyGoal::Study {
                    turn: 26,
                    skill: "FORC".to_string(),
                },
            ],
            casts: vec![],
            comment: String::new(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let mut content = content_with(vec![], vec![], vec![], vec![], vec![]);
        content.collections.study_plans = vec![plan.clone()];
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.collections.study_plans,
            vec![plan],
            "a month spent teaching comes back naming the same students, in order"
        );
    }

    /// ah-9qdz.2: a planned cast rides beside the goals, on a turn of its own, and a backup
    /// carries it as it carries the goals.
    #[test]
    fn a_planned_cast_survives_encode_and_decode() {
        let plan = StudyPlan {
            faction_id: "21".to_string(),
            unit_id: "9001".to_string(),
            goals: vec![StudyGoal::Study {
                turn: 26,
                skill: "FORC".to_string(),
            }],
            casts: vec![
                PlannedCast {
                    turn: 26,
                    spell: "FARS".to_string(),
                },
                PlannedCast {
                    turn: 27,
                    spell: "FIRE".to_string(),
                },
            ],
            comment: String::new(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let mut content = content_with(vec![], vec![], vec![], vec![], vec![]);
        content.collections.study_plans = vec![plan.clone()];
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.collections.study_plans,
            vec![plan],
            "every planned cast comes back on its own turn"
        );
    }

    /// Every plan stored before ah-9qdz.2 has no `casts` key, and reads as no cast on any turn.
    #[test]
    fn a_plan_without_casts_reads_as_no_cast() {
        let plan: StudyPlan = serde_json::from_str(
            r#"{"factionId":"21","unitId":"9001","goals":[],"comment":"","updatedAt":"2026-01-05T00:00:00Z"}"#,
        )
        .expect("deserializes");

        assert_eq!(plan.casts, Vec::<PlannedCast>::new());
    }

    /// ah-af7i: `live` says a teach cell means "teach whoever is eligible this turn". Every row
    /// written before that bead has no such key and must read back as a fixed list.
    #[test]
    fn a_teach_goal_without_live_reads_as_a_fixed_list() {
        let goal: StudyGoal =
            serde_json::from_str(r#"{"kind":"teach","turn":25,"students":["2517"]}"#)
                .expect("deserializes");

        assert_eq!(
            goal,
            StudyGoal::Teach {
                turn: 25,
                students: vec!["2517".to_string()],
                live: false,
            },
            "a goal stored before ah-af7i is a fixed list"
        );
    }

    #[test]
    fn a_live_teach_goal_round_trips() {
        let goal = StudyGoal::Teach {
            turn: 25,
            students: vec![],
            live: true,
        };

        let json = serde_json::to_string(&goal).expect("serializes");
        let back: StudyGoal = serde_json::from_str(&json).expect("deserializes");

        assert_eq!(back, goal, "a live teach goal survives a round trip");
    }

    #[test]
    fn a_study_plan_row_without_goals_decodes_to_an_empty_queue() {
        let plan = StudyPlan {
            faction_id: "21".to_string(),
            unit_id: "9001".to_string(),
            goals: vec![StudyGoal::Study {
                turn: 25,
                skill: "FORC".to_string(),
            }],
            casts: vec![],
            comment: "heading for Gate Lore".to_string(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let mut content = content_with(vec![], vec![], vec![], vec![], vec![]);
        content.collections.study_plans = vec![plan];
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");
        let mut value: serde_json::Value = serde_json::from_str(&encoded).expect("json");
        value
            .get_mut("studyPlans")
            .and_then(|plans| plans.get_mut(0))
            .and_then(|row| row.as_object_mut())
            .expect("the row")
            .remove("goals");

        let decoded = decode_game_backup(
            &serde_json::to_string(&value).expect("serializes"),
            "2026-02-01T00:00:00Z",
        )
        .expect("decodes");

        assert_eq!(
            decoded.collections.study_plans[0].goals,
            Vec::<StudyGoal>::new(),
            "an absent queue is an empty one"
        );
    }

    #[test]
    fn decode_stamps_the_manifest_with_the_opening_time() {
        let content = content_with(vec![], vec![], vec![], vec![], vec![]);
        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(decoded.manifest.last_opened_at, "2026-02-01T00:00:00Z");
    }

    #[test]
    fn a_manifest_metadata_without_an_active_faction_reads_as_none() {
        let metadata: GameMetadata = serde_json::from_str(
            "{\"gameId\":\"g\",\"gameName\":\"G\",\"rulesetId\":\"neworigins\"}",
        )
        .expect("a manifest written before this field still loads");

        assert_eq!(metadata.active_faction_id, None);
    }

    #[test]
    fn an_active_faction_survives_the_backup_round_trip() {
        let mut content = content_with(vec![], vec![], vec![], vec![], vec![]);
        content.manifest.metadata.active_faction_id = Some("95".to_string());
        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.manifest.metadata.active_faction_id,
            Some("95".to_string())
        );

        let unset = content_with(vec![], vec![], vec![], vec![], vec![]);
        let encoded = encode_game_backup(unset, "2026-01-03T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(decoded.manifest.metadata.active_faction_id, None);
    }

    #[test]
    fn decode_fills_a_turn_that_has_no_stamps_from_the_manifest() {
        let turn = GameBackupImportedTurn {
            faction_id: "1".to_string(),
            turn_number: 1,
            raw_report: "r".to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
            imported_at: None,
            updated_at: None,
        };
        let content = content_with(vec![turn], vec![], vec![], vec![], vec![]);
        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.collections.imported_turns[0].imported_at,
            manifest().created_at
        );
        assert_eq!(
            decoded.collections.imported_turns[0].updated_at,
            manifest().created_at
        );
    }

    #[test]
    fn decode_fills_updated_at_from_imported_at_when_only_that_is_missing() {
        let turn = GameBackupImportedTurn {
            faction_id: "1".to_string(),
            turn_number: 1,
            raw_report: "r".to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
            imported_at: Some("2026-01-05T00:00:00Z".to_string()),
            updated_at: None,
        };
        let content = content_with(vec![turn], vec![], vec![], vec![], vec![]);
        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.collections.imported_turns[0].imported_at,
            "2026-01-05T00:00:00Z"
        );
        assert_eq!(
            decoded.collections.imported_turns[0].updated_at,
            "2026-01-05T00:00:00Z"
        );
    }

    #[test]
    fn decode_rebuilds_each_sighting_from_its_payload() {
        let sighting = GameBackupRegionSighting {
            faction_id: "1".to_string(),
            region_id: "1:7,53".to_string(),
            last_seen_turn: 71,
            payload_json: sighting_payload(),
        };
        let content = content_with(vec![], vec![], vec![sighting], vec![], vec![]);
        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");
        let rebuilt = &decoded.collections.region_sightings[0];

        assert_eq!(rebuilt.faction_id, "1");
        assert_eq!(rebuilt.sighting.region_id, "1:7,53");
        assert_eq!(rebuilt.sighting.x, 7);
        assert_eq!(rebuilt.sighting.y, 53);
        assert_eq!(rebuilt.sighting.z, 1);
        assert_eq!(rebuilt.sighting.terrain, "plain");
        assert_eq!(rebuilt.sighting.province, "Inhead");
        assert_eq!(rebuilt.sighting.label, "plain (7,53) in Inhead");
        assert_eq!(rebuilt.sighting.last_seen_turn, 71);
    }

    #[test]
    fn decode_refuses_a_sighting_whose_payload_disagrees() {
        let sighting = GameBackupRegionSighting {
            faction_id: "1".to_string(),
            region_id: "1:7,53".to_string(),
            last_seen_turn: 71,
            payload_json: serde_json::json!({
                "regionId": "9:9,9",
                "coordinate": { "x": 9, "y": 9, "z": 9 },
                "terrain": "plain",
                "province": "P"
            })
            .to_string(),
        };
        let content = content_with(vec![], vec![], vec![sighting], vec![], vec![]);
        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        let error = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").unwrap_err();

        assert!(error.to_string().starts_with("invalid game backup: "));
        assert!(error.to_string().contains("does not match its payload id"));
    }

    #[test]
    fn decode_refuses_a_manifest_from_a_newer_version() {
        let mut m = manifest();
        m.manifest_version = 2;
        let content = GameBackupContent {
            manifest: m,
            collections: EncodedGameBackupCollections {
                imported_turns: vec![],
                order_drafts: vec![],
                region_sightings: vec![],
                merged_reports: vec![],
                hex_notes: vec![],
                armies: vec![],
                allied_mages: vec![],
                study_plans: vec![],
            },
        };
        let encoded = encode_game_backup(content, "2026-01-03T00:00:00Z").expect("encodes");

        let error = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").unwrap_err();

        assert!(matches!(
            error,
            BackupError::UnsupportedManifestVersion {
                actual: 2,
                max_supported: 1
            }
        ));
    }

    #[test]
    fn a_backup_round_trips_through_encode_and_decode() {
        let turn = GameBackupImportedTurn {
            faction_id: "1".to_string(),
            turn_number: 1,
            raw_report: "r".to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
            imported_at: Some("2026-01-05T00:00:00Z".to_string()),
            updated_at: Some("2026-01-05T00:00:00Z".to_string()),
        };
        let draft = GameBackupOrderDraft {
            faction_id: "1".to_string(),
            turn_number: 1,
            order_text: "GIVE 5 SILV".to_string(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let sighting = GameBackupRegionSighting {
            faction_id: "1".to_string(),
            region_id: "1:7,53".to_string(),
            last_seen_turn: 71,
            payload_json: sighting_payload(),
        };
        let merge = GameBackupMergedReport {
            faction_id: "1".to_string(),
            turn_number: 1,
            merged_faction_id: "2".to_string(),
            merged_faction_name: "Ally".to_string(),
            merged_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let note = GameBackupHexNote {
            id: "n1".to_string(),
            region_id: "1:7,53".to_string(),
            text: "note".to_string(),
            on_map: true,
            turn: 71,
            created_at: "2026-01-05T00:00:00Z".to_string(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };

        let content = content_with(
            vec![turn],
            vec![draft.clone()],
            vec![sighting],
            vec![merge.clone()],
            vec![note.clone()],
        );
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(decoded.collections.imported_turns[0].faction_id, "1");
        assert_eq!(
            decoded.collections.imported_turns[0].imported_at,
            "2026-01-05T00:00:00Z"
        );
        assert_eq!(decoded.collections.order_drafts[0], draft);
        assert_eq!(decoded.collections.merged_reports[0], merge);
        assert_eq!(decoded.collections.hex_notes[0], note);
    }

    /// ah-m6pw: a version-1 backup numbered every turn one low (February of Year 1 was turn 1), so
    /// restoring it moves every turn it names up by one - the same move migration 15 makes to a
    /// stored game - and a backup written today says version 2, whose turns are already right.
    /// Every integer a record holds under a key naming a turn, as a path: `key`, or `list[].key`
    /// inside a list of objects. JSON-string payloads are not opened.
    fn turn_paths(value: &serde_json::Value, prefix: &str, found: &mut BTreeSet<String>) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    let path = format!("{prefix}{key}");
                    if child.is_u64() && key.to_lowercase().contains("turn") {
                        found.insert(path);
                    } else {
                        turn_paths(child, &format!("{path}."), found);
                    }
                }
            }
            serde_json::Value::Array(entries) => {
                let list = prefix.trim_end_matches('.');
                for entry in entries {
                    turn_paths(entry, &format!("{list}[]."), found);
                }
            }
            _ => {}
        }
    }

    /// ah-aguu: the stored-turn list is written once, in `stored_turns`, so it is pinned here
    /// against what the backup collections actually hold. A record that gains a turn field fails
    /// this until the list says how the field moves; a listed field no record holds fails it too.
    #[test]
    fn every_turn_a_backup_collection_names_is_in_the_list() {
        use crate::stored_turns::{turn_fields, TurnField, COLLECTIONS_NAMING_A_TURN};

        let document =
            serde_json::to_value(every_collection_on_the_old_count()).expect("serialises");
        let collections: Vec<(&String, &Vec<serde_json::Value>)> = document
            .as_object()
            .expect("an object")
            .iter()
            .filter_map(|(name, value)| value.as_array().map(|records| (name, records)))
            .collect();
        assert_eq!(collections.len(), 8, "the fixture holds every collection");

        for (name, records) in collections {
            assert!(!records.is_empty(), "{name} has a record to read");
            let mut found = BTreeSet::new();
            for record in records {
                turn_paths(record, "", &mut found);
            }
            let mut declared = BTreeSet::new();
            for field in turn_fields(name) {
                match *field {
                    TurnField::Field(key) => {
                        declared.insert(key.to_string());
                    }
                    TurnField::EachEntry { list, field, .. } => {
                        declared.insert(format!("{list}[].{field}"));
                    }
                    TurnField::PayloadHeader(key) => {
                        assert!(
                            records.iter().all(|record| record[key].is_string()),
                            "{name}.{key} is a payload string"
                        );
                    }
                }
            }
            assert_eq!(found, declared, "the turns {name} names");
        }
        for (name, _) in COLLECTIONS_NAMING_A_TURN {
            assert!(
                document.get(*name).is_some(),
                "{name} is a backup collection"
            );
        }
    }

    /// One record in every collection, each naming its turns as version 1 counted them.
    fn every_collection_on_the_old_count() -> GameBackupContent {
        let unit = crate::report::parse_report_full(
            "plain (7,53) in Inhead.\n\n- Sweep Mage (9001), Borg (21), 1 leader [LEAD].\n",
        )
        .regions
        .remove(0)
        .units
        .remove(0);
        let member = ArmyMember {
            unit_id: "204".to_string(),
            name: "Pikes".to_string(),
            faction_id: None,
            faction_name: None,
            own: false,
            region_id: "1:7,53".to_string(),
            flags: vec![],
            items: vec![],
            skills: vec![],
            combat_spell: None,
            men: 10,
            seen_turn: 66,
            seen_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let mut content = content_with(
            vec![GameBackupImportedTurn {
                faction_id: "1".to_string(),
                turn_number: 71,
                raw_report: "r".to_string(),
                parsed_payload_json: {
                    // As version 1 stored it: December of Year 6 numbered 71.
                    let mut parsed =
                        crate::parse_report("Atlantis Report For:\nFoo (1)\nDecember, Year 6\n");
                    parsed
                        .turn_header
                        .as_mut()
                        .expect("a dated report")
                        .turn_number = 71;
                    serde_json::to_string(&parsed).expect("serialises")
                },
                warnings_payload_json: "[]".to_string(),
                imported_at: None,
                updated_at: None,
            }],
            vec![GameBackupOrderDraft {
                faction_id: "1".to_string(),
                turn_number: 71,
                order_text: "GIVE 5 SILV".to_string(),
                updated_at: "2026-01-05T00:00:00Z".to_string(),
            }],
            vec![GameBackupRegionSighting {
                faction_id: "1".to_string(),
                region_id: "1:7,53".to_string(),
                last_seen_turn: 68,
                payload_json: sighting_payload(),
            }],
            vec![GameBackupMergedReport {
                faction_id: "1".to_string(),
                turn_number: 71,
                merged_faction_id: "2".to_string(),
                merged_faction_name: "Ally".to_string(),
                merged_at: "2026-01-05T00:00:00Z".to_string(),
            }],
            vec![GameBackupHexNote {
                id: "n1".to_string(),
                region_id: "1:7,53".to_string(),
                text: "note".to_string(),
                on_map: true,
                turn: 69,
                created_at: "2026-01-05T00:00:00Z".to_string(),
                updated_at: "2026-01-05T00:00:00Z".to_string(),
            }],
        );
        content.collections.armies = vec![GameBackupArmy {
            id: "army-1".to_string(),
            name: "Escort".to_string(),
            members: vec![member],
            created_at: "2026-01-05T00:00:00Z".to_string(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        }];
        content.collections.allied_mages = vec![AlliedMage {
            faction_id: "21".to_string(),
            faction_name: Some("Borg".to_string()),
            unit,
            sheet_turn: 23,
            received_at: "2026-01-05T00:00:00Z".to_string(),
        }];
        content.collections.study_plans = vec![StudyPlan {
            faction_id: "21".to_string(),
            unit_id: "9001".to_string(),
            goals: vec![
                StudyGoal::Study {
                    turn: 0,
                    skill: "FORC".to_string(),
                },
                StudyGoal::Teach {
                    turn: 72,
                    students: vec![],
                    live: true,
                },
            ],
            casts: vec![
                PlannedCast {
                    turn: 0,
                    spell: "FIRE".to_string(),
                },
                PlannedCast {
                    turn: 72,
                    spell: "FARS".to_string(),
                },
            ],
            comment: String::new(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        }];
        content
    }

    #[test]
    fn a_version_one_backup_is_restored_at_the_engines_turn_numbers() {
        let content = every_collection_on_the_old_count();
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&encoded).expect("json")["version"],
            2,
            "a backup written today is numbered the engine's way"
        );
        let mut version_one: serde_json::Value = serde_json::from_str(&encoded).expect("json");
        version_one["version"] = serde_json::json!(1);

        let restored = decode_game_backup(&version_one.to_string(), "2026-02-01T00:00:00Z")
            .expect("decodes")
            .collections;

        let turn = &restored.imported_turns[0];
        assert_eq!(turn.turn_number, 72);
        let payload: crate::ReportParseResult =
            serde_json::from_str(&turn.parsed_payload_json).expect("payload still parses");
        assert_eq!(
            payload.turn_header.map(|header| header.turn_number),
            Some(72)
        );
        assert_eq!(restored.order_drafts[0].turn_number, 72);
        assert_eq!(restored.region_sightings[0].sighting.last_seen_turn, 69);
        assert_eq!(restored.merged_reports[0].turn_number, 72);
        assert_eq!(restored.hex_notes[0].turn, 70);
        assert_eq!(restored.armies[0].members[0].seen_turn, 67);
        assert_eq!(restored.allied_mages[0].sheet_turn, 24);
        assert_eq!(
            restored.study_plans[0].goals,
            vec![
                StudyGoal::Study {
                    turn: 0,
                    skill: "FORC".to_string(),
                },
                StudyGoal::Teach {
                    turn: 73,
                    students: vec![],
                    live: true,
                },
            ],
            "a goal's turn 0 marks a turnless legacy goal and stays 0"
        );
        assert_eq!(
            restored.study_plans[0]
                .casts
                .iter()
                .map(|cast| cast.turn)
                .collect::<Vec<_>>(),
            vec![1, 73],
            "a cast has no turnless form, so one on turn 0 moves too"
        );

        let current = decode_game_backup(&encoded, "2026-02-01T00:00:00Z")
            .expect("decodes")
            .collections;
        assert_eq!(
            current.imported_turns[0].turn_number, 71,
            "version 2 is left as written"
        );
        assert_eq!(current.hex_notes[0].turn, 69);
    }

    /// ah-vtgk: a version-1 backup was written while HUD numbered its turns one lower than the
    /// AtlaClient stamps it merged, so a hex merged from AtlaClient on the newest turn sits one turn
    /// above that faction's newest report even after the move to the engine's count. Restoring it
    /// caps that faction's sightings at its newest imported turn - the repair migration 16 makes to
    /// a stored desktop game - and leaves a faction with no AtlaClient merge as it was.
    #[test]
    fn a_version_one_backup_caps_atlaclient_sightings_at_the_newest_turn() {
        let turn = |faction_id: &str| GameBackupImportedTurn {
            faction_id: faction_id.to_string(),
            turn_number: 71,
            raw_report: "r".to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
            imported_at: None,
            updated_at: None,
        };
        let sighting = |faction_id: &str, last_seen_turn: u32| GameBackupRegionSighting {
            faction_id: faction_id.to_string(),
            region_id: "1:7,53".to_string(),
            last_seen_turn,
            payload_json: sighting_payload(),
        };
        let merge = |faction_id: &str, merged_faction_id: &str| GameBackupMergedReport {
            faction_id: faction_id.to_string(),
            turn_number: 71,
            merged_faction_id: merged_faction_id.to_string(),
            merged_faction_name: "AtlaClient, turn 72".to_string(),
            merged_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let content = content_with(
            vec![turn("1"), turn("2")],
            vec![],
            vec![sighting("1", 72), sighting("2", 72)],
            vec![
                merge("1", crate::report::atlaclient::ATLACLIENT_SOURCE_ID),
                merge("2", "21"),
            ],
            vec![],
        );
        let mut version_one: serde_json::Value = serde_json::from_str(
            &encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes"),
        )
        .expect("json");
        version_one["version"] = serde_json::json!(1);

        let restored = decode_game_backup(&version_one.to_string(), "2026-02-01T00:00:00Z")
            .expect("decodes")
            .collections;

        let seen = |faction_id: &str| {
            restored
                .region_sightings
                .iter()
                .find(|row| row.faction_id == faction_id)
                .map(|row| row.sighting.last_seen_turn)
        };
        assert_eq!(restored.imported_turns[0].turn_number, 72);
        assert_eq!(
            seen("1"),
            Some(72),
            "the AtlaClient-merged faction never reads past its newest turn"
        );
        assert_eq!(
            seen("2"),
            Some(73),
            "a faction with no AtlaClient merge only moves"
        );
    }
}
