//! One game as one file: the backup document both platforms export and import.
//!
//! The desktop stores in SQLite and the web in IndexedDB, and each used to encode and decode this
//! document itself. Every rule about the file - its envelope, its version bounds, what a row must
//! carry, what an absent stamp means, the order tables are written in - lives here and nowhere
//! else; a store reads its rows and hands them over, or takes rows back and writes them.

use serde::{Deserialize, Serialize};

use crate::movement::graph::MapGeometry;

use crate::report::model::{ItemAmount, Skill};
use crate::report::sighting::{sighting_from_payload, RegionSighting};

pub const GAME_BACKUP_FORMAT: &str = "atlantis-hud-game-backup";
pub const CURRENT_GAME_BACKUP_VERSION: u32 = 1;
/// Moved from core-persistence with the manifest types; `create_game`/`open_game` still check it.
pub const CURRENT_MANIFEST_VERSION: u32 = 1;

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
    /// The map this game is played on, or `None` for a game that was never told one - which is
    /// every game created before the app asked, and every backup restored from before it.
    ///
    /// The absence is the record that nothing was stated, so the ruleset's declared default is
    /// only *assumed* and the settings dialog says so. `skip_serializing_if` keeps that true on
    /// the way out as well: a `"map": null` written into an old game's manifest would be a claim
    /// nobody made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub map: Option<MapGeometry>,
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
    /// `None` **removes** the key. A game that was never told a map is not the same as one told
    /// `null`: the absence is what makes the settings dialog say the ruleset's default is only
    /// assumed, and `skip_serializing_if` on the field is what keeps it absent on the way out.
    Map(Option<MapGeometry>),
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
        ManifestEdit::Map(map) => manifest.metadata.map = *map,
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

/// One unit as an Army remembers it: the last report that showed it, whichever turn that was.
///
/// A member the current report does not mention is kept and still exported - it may be another
/// faction's unit that is simply not visible this turn - so a membership carries a whole snapshot
/// rather than a unit number, and carries everything an export needs.
///
/// It lives here, rather than in `core-persistence`, because the backup carries it too and both
/// stores read it; `core-persistence` re-exports it, as it already does `GameManifest`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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

/// The rows of one game, without the envelope: what a store hands over to be encoded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackupContent {
    pub manifest: GameManifest,
    pub imported_turns: Vec<GameBackupImportedTurn>,
    pub order_drafts: Vec<GameBackupOrderDraft>,
    pub region_sightings: Vec<GameBackupRegionSighting>,
    pub merged_reports: Vec<GameBackupMergedReport>,
    #[serde(default)]
    pub hex_notes: Vec<GameBackupHexNote>,
    #[serde(default)]
    pub armies: Vec<GameBackupArmy>,
}

/// The document as written: the envelope around the content. `#[serde(default)]` on
/// `exported_at` (a file written by hand may omit it; nothing reads it back), on `hex_notes`
/// (absent in a backup written before ah-o1t.1) and on `armies` (absent in one written before
/// ah-1mpx.1); such a backup still imports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBackup {
    pub format: String,
    pub version: u32,
    #[serde(default)]
    pub exported_at: String,
    pub manifest: GameManifest,
    pub imported_turns: Vec<GameBackupImportedTurn>,
    pub order_drafts: Vec<GameBackupOrderDraft>,
    pub region_sightings: Vec<GameBackupRegionSighting>,
    pub merged_reports: Vec<GameBackupMergedReport>,
    #[serde(default)]
    pub hex_notes: Vec<GameBackupHexNote>,
    #[serde(default)]
    pub armies: Vec<GameBackupArmy>,
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
    pub imported_turns: Vec<DecodedImportedTurn>,
    pub order_drafts: Vec<GameBackupOrderDraft>,
    pub region_sightings: Vec<DecodedRegionSighting>,
    pub merged_reports: Vec<GameBackupMergedReport>,
    pub hex_notes: Vec<GameBackupHexNote>,
    pub armies: Vec<GameBackupArmy>,
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

/// One game -> one document. Sorts every table so two exports of the same game are byte-identical
/// whichever platform wrote them: turns by (faction_id, turn_number); drafts by (faction_id,
/// turn_number); sightings by (faction_id, region_id); merged reports by (faction_id,
/// turn_number, merged_at, merged_faction_id); hex notes by (created_at, id) - the same keys the
/// desktop's five ORDER BYs used - and Armies by (name, id), which is `sortArmies`' order.
/// Pretty-printed with two-space indent.
pub fn encode_game_backup(
    content: GameBackupContent,
    exported_at: &str,
) -> Result<String, BackupError> {
    let GameBackupContent {
        manifest,
        mut imported_turns,
        mut order_drafts,
        mut region_sightings,
        mut merged_reports,
        mut hex_notes,
        mut armies,
    } = content;

    imported_turns.sort_by_key(sort_key_turn);
    order_drafts.sort_by_key(sort_key_draft);
    region_sightings.sort_by_key(sort_key_sighting);
    merged_reports.sort_by_key(sort_key_merge);
    hex_notes.sort_by_key(sort_key_note);
    armies.sort_by_key(sort_key_army);

    let backup = GameBackup {
        format: GAME_BACKUP_FORMAT.to_string(),
        version: CURRENT_GAME_BACKUP_VERSION,
        exported_at: exported_at.to_string(),
        manifest,
        imported_turns,
        order_drafts,
        region_sightings,
        merged_reports,
        hex_notes,
        armies,
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

    let mut manifest = backup.manifest;
    let created_at = manifest.created_at.clone();
    manifest.last_opened_at = opened_at.to_string();

    let imported_turns = backup
        .imported_turns
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

    let region_sightings = backup
        .region_sightings
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
        imported_turns,
        order_drafts: backup.order_drafts,
        region_sightings,
        merged_reports: backup.merged_reports,
        hex_notes: backup.hex_notes,
        armies: backup.armies,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn setting_the_map_records_it() {
        let mut edited = manifest();
        let map = MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
        };

        apply_manifest_edit(&mut edited, &ManifestEdit::Map(Some(map)));

        assert_eq!(edited.metadata.map, Some(map));
    }

    #[test]
    fn clearing_the_map_removes_the_key() {
        let mut edited = manifest();
        edited.metadata.map = Some(MapGeometry {
            width: 72,
            height: 96,
            wrap_x: true,
            wrap_y: false,
        });

        apply_manifest_edit(&mut edited, &ManifestEdit::Map(None));

        let json = serde_json::to_value(&edited.metadata).expect("serialises");
        let object = json.as_object().expect("an object");
        assert!(!object.contains_key("map"), "got {object:?}");
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
            imported_turns: turns,
            order_drafts: drafts,
            region_sightings: sightings,
            merged_reports: merges,
            hex_notes: notes,
            armies: vec![],
        }
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
        assert!(encoded.contains("\"version\": 1"));
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
            .contains("newer than this build supports (1)"));
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

        assert!(decoded.hex_notes.is_empty());
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

        assert!(decoded.armies.is_empty());
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
                }],
                skills: vec![Skill {
                    name: "combat".to_string(),
                    tag: "COMB".to_string(),
                    level: 2,
                    points: 90,
                }],
                men: 12,
                seen_turn: 68,
                seen_at: "2026-01-05T00:00:00Z".to_string(),
            }],
            created_at: "2026-01-05T00:00:00Z".to_string(),
            updated_at: "2026-01-05T00:00:00Z".to_string(),
        };
        let content = GameBackupContent {
            armies: vec![army.clone()],
            ..content_with(vec![], vec![], vec![], vec![], vec![])
        };
        let encoded = encode_game_backup(content, "2026-01-06T00:00:00Z").expect("encodes");

        let decoded = decode_game_backup(&encoded, "2026-02-01T00:00:00Z").expect("decodes");

        assert_eq!(
            decoded.armies,
            vec![army],
            "a concealed faction stays None, and items and skills come back whole"
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

        assert_eq!(decoded.imported_turns[0].imported_at, manifest().created_at);
        assert_eq!(decoded.imported_turns[0].updated_at, manifest().created_at);
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
            decoded.imported_turns[0].imported_at,
            "2026-01-05T00:00:00Z"
        );
        assert_eq!(decoded.imported_turns[0].updated_at, "2026-01-05T00:00:00Z");
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
        let rebuilt = &decoded.region_sightings[0];

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
            imported_turns: vec![],
            order_drafts: vec![],
            region_sightings: vec![],
            merged_reports: vec![],
            hex_notes: vec![],
            armies: vec![],
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

        assert_eq!(decoded.imported_turns[0].faction_id, "1");
        assert_eq!(
            decoded.imported_turns[0].imported_at,
            "2026-01-05T00:00:00Z"
        );
        assert_eq!(decoded.order_drafts[0], draft);
        assert_eq!(decoded.merged_reports[0], merge);
        assert_eq!(decoded.hex_notes[0], note);
    }
}
