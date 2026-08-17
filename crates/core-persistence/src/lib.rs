//! Persistence contracts for Atlantis HUD game state.

use std::fs;
use std::path::{Path, PathBuf};

use atlantis_hud_core::backup::{
    encode_game_backup, GameBackupContent, GameBackupHexNote, GameBackupImportedTurn,
    GameBackupMergedReport, GameBackupOrderDraft, GameBackupRegionSighting,
};
use atlantis_hud_core::reopen::{latest_turn, TurnRef};
use atlantis_hud_core::{diff_imported_turn_fields, ImportedTurnSnapshotRef};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current schema version expected by the persistence layer.
pub const CURRENT_SCHEMA_VERSION: u32 = 8;
/// The manifest file inside a game's directory. The directory is named after the game's id, so the
/// file itself does not have to be, and a game can be found without parsing any filename.
pub const GAME_MANIFEST_FILE_NAME: &str = "game.json";
const MIGRATION_0001_INITIAL: &str = include_str!("../migrations/0001_initial.sql");
const MIGRATION_0002_IMPORTED_TURNS: &str = include_str!("../migrations/0002_imported_turns.sql");
const MIGRATION_0003_ORDER_DRAFTS: &str = include_str!("../migrations/0003_order_drafts.sql");
const MIGRATION_0004_REGION_SIGHTINGS: &str =
    include_str!("../migrations/0004_region_sightings.sql");
const MIGRATION_0005_RENAME_PROJECT_TO_GAME: &str =
    include_str!("../migrations/0005_rename_project_to_game.sql");
const MIGRATION_0006_ISO_IMPORT_TIMESTAMPS: &str =
    include_str!("../migrations/0006_iso_import_timestamps.sql");
const MIGRATION_0007_MERGED_REPORTS: &str = include_str!("../migrations/0007_merged_reports.sql");
const MIGRATION_0008_HEX_NOTES: &str = include_str!("../migrations/0008_hex_notes.sql");

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: [Migration; 8] = [
    Migration {
        version: 1,
        sql: MIGRATION_0001_INITIAL,
    },
    Migration {
        version: 2,
        sql: MIGRATION_0002_IMPORTED_TURNS,
    },
    Migration {
        version: 3,
        sql: MIGRATION_0003_ORDER_DRAFTS,
    },
    Migration {
        version: 4,
        sql: MIGRATION_0004_REGION_SIGHTINGS,
    },
    Migration {
        version: 5,
        sql: MIGRATION_0005_RENAME_PROJECT_TO_GAME,
    },
    Migration {
        version: 6,
        sql: MIGRATION_0006_ISO_IMPORT_TIMESTAMPS,
    },
    Migration {
        version: 7,
        sql: MIGRATION_0007_MERGED_REPORTS,
    },
    Migration {
        version: 8,
        sql: MIGRATION_0008_HEX_NOTES,
    },
];

/// Game metadata, a logical report source and the manifest built from them now live in the core,
/// which both stores' backups agree on; `core-tauri` still imports all three from this crate.
pub use atlantis_hud_core::backup::{GameManifest, GameMetadata, ReportSourceRef};

/// Snapshot returned after game create/open operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedGame {
    pub game_file_path: PathBuf,
    pub database_path: PathBuf,
    pub schema_version: u32,
    pub manifest: GameManifest,
}

/// Unique key for one imported turn in a game.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTurnKey {
    pub game_id: String,
    pub faction_id: String,
    pub turn_number: u32,
}

/// Summary of one imported turn, enough to label it without loading the full report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTurnSummary {
    pub key: ImportedTurnKey,
    pub season: Option<String>,
    pub imported_at: String,
    pub updated_at: String,
}

/// The stamps of one imported turn, or `None` when it was never imported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTurnStamps {
    pub imported_at: String,
    pub updated_at: String,
}

/// Persisted imported turn payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTurnRecord {
    pub key: ImportedTurnKey,
    pub raw_report: String,
    pub parsed_payload_json: String,
    pub warnings_payload_json: String,
}

/// Import conflict preview for duplicate imports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTurnPreview {
    pub exists: bool,
    pub raw_changed: bool,
    pub parsed_changed: bool,
    pub warnings_changed: bool,
}

/// One region as last seen, with the turn it was seen in.
///
/// The map distinguishes a region present in the current report from one held over from an earlier
/// turn, so a sighting carries its own turn rather than inheriting the latest import's.
///
/// Defined in the core rather than here, because both platforms build these rows from the same
/// parse and must not be able to disagree about what a sighting is. This is the whole row, which is
/// what SQLite persists; IndexedDB indexes by region alone, so the browser store keeps only the
/// region, the turn and the payload out of it.
pub use atlantis_hud_core::report::sighting::RegionSighting;

/// Unique key for one persisted order draft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderDraftKey {
    pub game_id: String,
    pub faction_id: String,
    pub turn_number: u32,
}

/// Persisted order draft payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderDraftRecord {
    pub key: OrderDraftKey,
    pub order_text: String,
    pub updated_at: String,
}

/// One player-written note on a hex, keyed by id.
#[derive(Debug, Clone, PartialEq, Eq)]
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

/// One allied report folded into a faction's map for one turn.
///
/// A merge writes the ally's regions under the viewer's own faction and stores no turn of the
/// ally's, so this row is the only thing that remembers it happened. `faction_id` is the map that
/// grew; `merged_faction_id` is whose report grew it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedReportRecord {
    pub game_id: String,
    pub faction_id: String,
    pub turn_number: u32,
    pub merged_faction_id: String,
    pub merged_faction_name: String,
    pub merged_at: String,
}

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid game manifest version: expected <= {max_supported}, got {actual}")]
    UnsupportedManifestVersion { max_supported: u32, actual: u32 },
    #[error(transparent)]
    Backup(#[from] atlantis_hud_core::backup::BackupError),
    #[error("database file does not exist: {0}")]
    DatabaseFileMissing(String),
    #[error("game file already exists: {0}")]
    GameFileAlreadyExists(String),
    #[error("database file already exists: {0}")]
    DatabaseAlreadyExists(String),
    #[error("no game with id {0}")]
    GameNotFound(String),
    #[error(
        "imported turn already exists for game {game_id}, faction {faction_id}, turn {turn_number}"
    )]
    DuplicateImportedTurn {
        game_id: String,
        faction_id: String,
        turn_number: u32,
    },
}

/// Creates a game under `games_root`, in a directory of its own.
///
/// The caller supplies a root and an identity, never a path. The player names a game; where its
/// bytes live is the application's business, and letting the frontend compose that path is how a
/// database once ended up committed inside the repository.
///
/// # Errors
///
/// Returns an error when a game already exists under this id, when the manifest version is not
/// supported, or when the directory cannot be written.
pub fn create_game(
    games_root: &Path,
    manifest: &GameManifest,
) -> Result<OpenedGame, PersistenceError> {
    let home = game_home(games_root, &manifest.metadata.game_id);
    let game_file_path = home.join(GAME_MANIFEST_FILE_NAME);

    ensure_supported_manifest_version(manifest.manifest_version)?;
    if game_file_path.exists() {
        return Err(PersistenceError::GameFileAlreadyExists(
            game_file_path.to_string_lossy().to_string(),
        ));
    }

    let database_path = sidecar_database_path(&game_file_path);
    if database_path.exists() {
        return Err(PersistenceError::DatabaseAlreadyExists(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let temp_manifest_path = write_game_manifest_temp(&game_file_path, manifest)?;

    let mut connection = match open_database(&database_path) {
        Ok(connection) => connection,
        Err(error) => {
            cleanup_file_if_exists(&temp_manifest_path);
            return Err(error);
        }
    };

    if let Err(error) = apply_migrations(&mut connection) {
        cleanup_file_if_exists(&temp_manifest_path);
        cleanup_file_if_exists(&database_path);
        return Err(error);
    }

    if let Err(error) = persist_game_snapshot(&mut connection, manifest) {
        cleanup_file_if_exists(&temp_manifest_path);
        cleanup_file_if_exists(&database_path);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temp_manifest_path, &game_file_path) {
        cleanup_file_if_exists(&temp_manifest_path);
        cleanup_file_if_exists(&database_path);
        return Err(PersistenceError::Io(error));
    }

    Ok(OpenedGame {
        game_file_path,
        database_path,
        schema_version: current_schema_version(&connection)?,
        manifest: manifest.clone(),
    })
}

/// Opens a game by id, upgrading its schema if needed and stamping when it was opened.
///
/// The stamp is written back to the manifest because it is what decides which game reopens next
/// time. `opened_at` comes from the caller rather than from the clock here: the browser and the
/// desktop then agree on the format, and this crate acquires no notion of time it would otherwise
/// have to be told about in tests.
///
/// # Errors
///
/// Returns an error when no game exists under this id, when its manifest cannot be read, or when
/// the database cannot be opened or migrated.
pub fn open_game(
    games_root: &Path,
    game_id: &str,
    opened_at: &str,
) -> Result<OpenedGame, PersistenceError> {
    let game_file_path = game_home(games_root, game_id).join(GAME_MANIFEST_FILE_NAME);
    if !game_file_path.exists() {
        return Err(PersistenceError::GameNotFound(game_id.to_string()));
    }

    let mut manifest = load_game_manifest(&game_file_path)?;
    ensure_supported_manifest_version(manifest.manifest_version)?;
    manifest.last_opened_at = opened_at.to_string();

    let database_path = sidecar_database_path(&game_file_path);
    let mut connection = open_database(&database_path)?;
    apply_migrations(&mut connection)?;
    persist_game_snapshot(&mut connection, &manifest)?;
    save_game_manifest(&game_file_path, &manifest)?;

    Ok(OpenedGame {
        game_file_path,
        database_path,
        schema_version: current_schema_version(&connection)?,
        manifest,
    })
}

/// Changes which ruleset a game is played under, after creation.
///
/// The id is stored as an opaque string, exactly as `create_game` accepts one: which rulesets ship
/// is a concern of the frontends' registry, and this crate refusing ids it has not heard of would
/// make every new ruleset a lockstep release of both.
///
/// # Errors
///
/// Returns an error when no game exists under this id, when its manifest cannot be read, or when
/// the database cannot be opened or migrated.
pub fn set_game_ruleset(
    games_root: &Path,
    game_id: &str,
    ruleset_id: &str,
) -> Result<GameManifest, PersistenceError> {
    let game_file_path = game_home(games_root, game_id).join(GAME_MANIFEST_FILE_NAME);
    if !game_file_path.exists() {
        return Err(PersistenceError::GameNotFound(game_id.to_string()));
    }

    let mut manifest = load_game_manifest(&game_file_path)?;
    ensure_supported_manifest_version(manifest.manifest_version)?;
    manifest.metadata.ruleset_id = ruleset_id.to_string();

    // Database first, manifest second — the order `open_game` writes in, so a failure between the
    // two leaves the manifest (which the frontends read) still agreeing with itself.
    let database_path = sidecar_database_path(&game_file_path);
    let mut connection = open_database(&database_path)?;
    apply_migrations(&mut connection)?;
    persist_game_snapshot(&mut connection, &manifest)?;
    save_game_manifest(&game_file_path, &manifest)?;

    Ok(manifest)
}

/// Renames a game, after creation.
///
/// The name is stored as given: trimming and the refusal of an empty name are the shell's
/// (`gameSession.ts`'s `gameNameOf`), the same rule applied at creation.
///
/// # Errors
///
/// Returns an error when no game exists under this id, when its manifest cannot be read, or when
/// the database cannot be opened or migrated.
pub fn set_game_name(
    games_root: &Path,
    game_id: &str,
    game_name: &str,
) -> Result<GameManifest, PersistenceError> {
    let game_file_path = game_home(games_root, game_id).join(GAME_MANIFEST_FILE_NAME);
    if !game_file_path.exists() {
        return Err(PersistenceError::GameNotFound(game_id.to_string()));
    }

    let mut manifest = load_game_manifest(&game_file_path)?;
    ensure_supported_manifest_version(manifest.manifest_version)?;
    manifest.metadata.game_name = game_name.to_string();

    // Database first, manifest second — the order `open_game` writes in, so a failure between the
    // two leaves the manifest (which the frontends read) still agreeing with itself.
    let database_path = sidecar_database_path(&game_file_path);
    let mut connection = open_database(&database_path)?;
    apply_migrations(&mut connection)?;
    persist_game_snapshot(&mut connection, &manifest)?;
    save_game_manifest(&game_file_path, &manifest)?;

    Ok(manifest)
}

/// Records which faction in this game is the player's, after creation.
///
/// The id is stored as the report names it, opaque to this crate, exactly as `confirmed_faction_id`
/// reaches `commit_report_import`. Which faction that is - and when it may change - is the shell's
/// decision, never this crate's.
///
/// # Errors
///
/// Returns an error when no game exists under this id, when its manifest cannot be read, or when
/// the database cannot be opened or migrated.
pub fn set_active_faction(
    games_root: &Path,
    game_id: &str,
    faction_id: &str,
) -> Result<GameManifest, PersistenceError> {
    let game_file_path = game_home(games_root, game_id).join(GAME_MANIFEST_FILE_NAME);
    if !game_file_path.exists() {
        return Err(PersistenceError::GameNotFound(game_id.to_string()));
    }

    let mut manifest = load_game_manifest(&game_file_path)?;
    ensure_supported_manifest_version(manifest.manifest_version)?;
    manifest.metadata.active_faction_id = Some(faction_id.to_string());

    // Database first, manifest second — the order `open_game` writes in, so a failure between the
    // two leaves the manifest (which the frontends read) still agreeing with itself.
    let database_path = sidecar_database_path(&game_file_path);
    let mut connection = open_database(&database_path)?;
    apply_migrations(&mut connection)?;
    persist_game_snapshot(&mut connection, &manifest)?;
    save_game_manifest(&game_file_path, &manifest)?;

    Ok(manifest)
}

/// Every game under `games_root`, read from the games themselves.
///
/// There is no index to consult: the games on disk are the list. That costs one small read per
/// game and buys the guarantee that a listing can never disagree with what is actually there.
///
/// A directory whose manifest is missing or unreadable is skipped rather than failing the whole
/// listing, because one broken game must not hide every other game from the player.
///
/// # Errors
///
/// Returns an error when the root exists but cannot be read. A root that does not exist yet is the
/// ordinary first-run case and yields an empty list.
pub fn list_games(games_root: &Path) -> Result<Vec<GameManifest>, PersistenceError> {
    if !games_root.exists() {
        return Ok(Vec::new());
    }

    let mut games = Vec::new();
    for entry in fs::read_dir(games_root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }

        let manifest_path = entry.path().join(GAME_MANIFEST_FILE_NAME);
        match load_game_manifest(&manifest_path) {
            Ok(manifest)
                if manifest.manifest_version
                    <= atlantis_hud_core::backup::CURRENT_MANIFEST_VERSION =>
            {
                games.push(manifest);
            }
            _ => continue,
        }
    }

    Ok(games)
}

/// Deletes a game and everything it stored.
///
/// The whole directory goes, which is what makes the deletion complete: a game's turns, orders and
/// remembered map live nowhere else, so there is nothing left behind to leak into the next game
/// that happens to reuse an id.
///
/// # Errors
///
/// Returns an error naming the game when no game exists under this id, or when the directory
/// cannot be removed.
pub fn delete_game(games_root: &Path, game_id: &str) -> Result<(), PersistenceError> {
    let home = game_home(games_root, game_id);
    if !home.join(GAME_MANIFEST_FILE_NAME).exists() {
        return Err(PersistenceError::GameNotFound(game_id.to_string()));
    }

    fs::remove_dir_all(&home)?;
    Ok(())
}

/// Exports one whole game to one JSON document.
pub fn export_game(
    games_root: &Path,
    game_id: &str,
    exported_at: &str,
) -> Result<String, PersistenceError> {
    let game_file_path = game_home(games_root, game_id).join(GAME_MANIFEST_FILE_NAME);
    if !game_file_path.exists() {
        return Err(PersistenceError::GameNotFound(game_id.to_string()));
    }

    let manifest = load_game_manifest(&game_file_path)?;
    ensure_supported_manifest_version(manifest.manifest_version)?;
    let database_path = sidecar_database_path(&game_file_path);
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(&database_path)?;
    apply_migrations(&mut connection)?;

    let mut turns = connection.prepare(
        "SELECT faction_id,
                turn_number,
                raw_report,
                parsed_payload_json,
                warnings_payload_json,
                imported_at,
                updated_at
           FROM imported_turns
          WHERE game_id = ?1",
    )?;
    let imported_turns = turns
        .query_map(params![game_id], |row| {
            Ok(GameBackupImportedTurn {
                faction_id: row.get(0)?,
                turn_number: row.get(1)?,
                raw_report: row.get(2)?,
                parsed_payload_json: row.get(3)?,
                warnings_payload_json: row.get(4)?,
                imported_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut drafts = connection.prepare(
        "SELECT faction_id, turn_number, order_text, updated_at
           FROM order_drafts
          WHERE game_id = ?1",
    )?;
    let order_drafts = drafts
        .query_map(params![game_id], |row| {
            Ok(GameBackupOrderDraft {
                faction_id: row.get(0)?,
                turn_number: row.get(1)?,
                order_text: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut sightings = connection.prepare(
        "SELECT faction_id, region_id, last_seen_turn, payload_json
           FROM region_sightings
          WHERE game_id = ?1",
    )?;
    let region_sightings = sightings
        .query_map(params![game_id], |row| {
            Ok(GameBackupRegionSighting {
                faction_id: row.get(0)?,
                region_id: row.get(1)?,
                last_seen_turn: row.get(2)?,
                payload_json: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut merges = connection.prepare(
        "SELECT faction_id, turn_number, merged_faction_id, merged_faction_name, merged_at
           FROM merged_reports
          WHERE game_id = ?1",
    )?;
    let merged_reports = merges
        .query_map(params![game_id], |row| {
            Ok(GameBackupMergedReport {
                faction_id: row.get(0)?,
                turn_number: row.get(1)?,
                merged_faction_id: row.get(2)?,
                merged_faction_name: row.get(3)?,
                merged_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut notes = connection.prepare(
        "SELECT id, region_id, text, on_map, turn, created_at, updated_at
           FROM hex_notes
          WHERE game_id = ?1",
    )?;
    let hex_notes = notes
        .query_map(params![game_id], |row| {
            Ok(GameBackupHexNote {
                id: row.get(0)?,
                region_id: row.get(1)?,
                text: row.get(2)?,
                on_map: row.get::<_, i64>(3)? != 0,
                turn: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    encode_game_backup(
        GameBackupContent {
            manifest,
            imported_turns,
            order_drafts,
            region_sightings,
            merged_reports,
            hex_notes,
        },
        exported_at,
    )
    .map_err(PersistenceError::from)
}

/// Creates one whole game from one exported JSON document and opens it.
pub fn import_game(
    games_root: &Path,
    backup_json: &str,
    opened_at: &str,
) -> Result<OpenedGame, PersistenceError> {
    let decoded = atlantis_hud_core::backup::decode_game_backup(backup_json, opened_at)?;

    let game_id = decoded.manifest.metadata.game_id.clone();
    let opened = create_game(games_root, &decoded.manifest)?;

    let import_result = (|| -> Result<(), PersistenceError> {
        let mut connection = open_database(&opened.database_path)?;
        apply_migrations(&mut connection)?;
        let transaction = connection.transaction()?;

        for turn in &decoded.imported_turns {
            transaction.execute(
                "INSERT INTO imported_turns (
                    game_id,
                    faction_id,
                    turn_number,
                    raw_report,
                    parsed_payload_json,
                    warnings_payload_json,
                    imported_at,
                    updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    game_id.as_str(),
                    turn.faction_id.as_str(),
                    turn.turn_number,
                    turn.raw_report.as_str(),
                    turn.parsed_payload_json.as_str(),
                    turn.warnings_payload_json.as_str(),
                    turn.imported_at.as_str(),
                    turn.updated_at.as_str(),
                ],
            )?;
        }

        for draft in &decoded.order_drafts {
            transaction.execute(
                "INSERT INTO order_drafts (
                    game_id,
                    faction_id,
                    turn_number,
                    order_text,
                    updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    game_id.as_str(),
                    draft.faction_id.as_str(),
                    draft.turn_number,
                    draft.order_text.as_str(),
                    draft.updated_at.as_str(),
                ],
            )?;
        }

        for sighting in &decoded.region_sightings {
            let s = &sighting.sighting;
            transaction.execute(
                "INSERT INTO region_sightings (
                    game_id,
                    faction_id,
                    region_id,
                    x,
                    y,
                    z,
                    terrain,
                    province,
                    label,
                    last_seen_turn,
                    payload_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    game_id.as_str(),
                    sighting.faction_id.as_str(),
                    s.region_id.as_str(),
                    s.x,
                    s.y,
                    s.z,
                    s.terrain.as_str(),
                    s.province.as_str(),
                    s.label.as_str(),
                    s.last_seen_turn,
                    s.payload_json.as_str(),
                ],
            )?;
        }

        for record in &decoded.merged_reports {
            transaction.execute(
                "INSERT INTO merged_reports (
                    game_id,
                    faction_id,
                    turn_number,
                    merged_faction_id,
                    merged_faction_name,
                    merged_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    game_id.as_str(),
                    record.faction_id.as_str(),
                    record.turn_number,
                    record.merged_faction_id.as_str(),
                    record.merged_faction_name.as_str(),
                    record.merged_at.as_str(),
                ],
            )?;
        }

        for note in &decoded.hex_notes {
            transaction.execute(
                "INSERT INTO hex_notes (
                    id,
                    game_id,
                    region_id,
                    text,
                    on_map,
                    turn,
                    created_at,
                    updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    note.id.as_str(),
                    game_id.as_str(),
                    note.region_id.as_str(),
                    note.text.as_str(),
                    i64::from(note.on_map),
                    note.turn,
                    note.created_at.as_str(),
                    note.updated_at.as_str(),
                ],
            )?;
        }

        transaction.commit()?;
        Ok(())
    })();

    if let Err(error) = import_result {
        let _ = delete_game(games_root, &game_id);
        return Err(error);
    }

    Ok(opened)
}

/// Reads schema version from an existing database file.
pub fn schema_version(database_path: &Path) -> Result<u32, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let connection = Connection::open(database_path)?;
    current_schema_version_read_only(&connection)
}

/// Compares an incoming turn import against an existing row.
pub fn preview_imported_turn(
    database_path: &Path,
    candidate: &ImportedTurnRecord,
) -> Result<ImportedTurnPreview, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    let existing = load_imported_turn_from_connection(&connection, &candidate.key)?;

    // The comparison itself lives in `core` so the browser storage adapter, which has no SQLite,
    // reaches an identical verdict. Both sides are borrowed, so nothing is copied to compare them.
    let existing_snapshot = existing.as_ref().map(borrow_snapshot);
    let candidate_snapshot = borrow_snapshot(candidate);
    let diff = diff_imported_turn_fields(existing_snapshot, candidate_snapshot);

    Ok(ImportedTurnPreview {
        exists: diff.exists,
        raw_changed: diff.raw_changed,
        parsed_changed: diff.parsed_changed,
        warnings_changed: diff.warnings_changed,
    })
}

fn borrow_snapshot(record: &ImportedTurnRecord) -> ImportedTurnSnapshotRef<'_> {
    ImportedTurnSnapshotRef {
        raw_report: &record.raw_report,
        parsed_payload_json: &record.parsed_payload_json,
        warnings_payload_json: &record.warnings_payload_json,
    }
}

/// Inserts or updates one imported turn payload.
///
/// `imported_at` and `updated_at` are the caller's clock readings, in the same ISO-8601 form
/// `OrderDraftRecord.updated_at` carries. This crate reads no clock of its own and keeps neither
/// stamp back: which one a re-import keeps is decided once, in the core's `import_writes`, not
/// here - the store writes exactly the two stamps it is given.
pub fn upsert_imported_turn(
    database_path: &Path,
    record: &ImportedTurnRecord,
    imported_at: &str,
    updated_at: &str,
) -> Result<(), PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    connection.execute(
        "INSERT INTO imported_turns (
            game_id,
            faction_id,
            turn_number,
            raw_report,
            parsed_payload_json,
            warnings_payload_json,
            imported_at,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(game_id, faction_id, turn_number) DO UPDATE SET
            raw_report = excluded.raw_report,
            parsed_payload_json = excluded.parsed_payload_json,
            warnings_payload_json = excluded.warnings_payload_json,
            imported_at = excluded.imported_at,
            updated_at = excluded.updated_at",
        params![
            record.key.game_id.as_str(),
            record.key.faction_id.as_str(),
            record.key.turn_number,
            record.raw_report.as_str(),
            record.parsed_payload_json.as_str(),
            record.warnings_payload_json.as_str(),
            imported_at,
            updated_at,
        ],
    )?;
    Ok(())
}

/// Inserts one imported turn payload and fails if the key already exists.
///
/// `imported_at` and `updated_at` are the caller's clock readings, for the reason given on
/// [`upsert_imported_turn`].
pub fn insert_imported_turn(
    database_path: &Path,
    record: &ImportedTurnRecord,
    imported_at: &str,
    updated_at: &str,
) -> Result<(), PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    let insert_result = connection.execute(
        "INSERT INTO imported_turns (
            game_id,
            faction_id,
            turn_number,
            raw_report,
            parsed_payload_json,
            warnings_payload_json,
            imported_at,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.key.game_id.as_str(),
            record.key.faction_id.as_str(),
            record.key.turn_number,
            record.raw_report.as_str(),
            record.parsed_payload_json.as_str(),
            record.warnings_payload_json.as_str(),
            imported_at,
            updated_at,
        ],
    );
    match insert_result {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(error, _))
            if matches!(error.code, ErrorCode::ConstraintViolation) =>
        {
            Err(PersistenceError::DuplicateImportedTurn {
                game_id: record.key.game_id.clone(),
                faction_id: record.key.faction_id.clone(),
                turn_number: record.key.turn_number,
            })
        }
        Err(error) => Err(PersistenceError::Database(error)),
    }
}

/// Loads one imported turn by composite key.
pub fn load_imported_turn(
    database_path: &Path,
    key: &ImportedTurnKey,
) -> Result<Option<ImportedTurnRecord>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    load_imported_turn_from_connection(&connection, key)
}

/// The stamps of one imported turn, or `None` when it was never imported.
pub fn load_imported_turn_stamps(
    database_path: &Path,
    key: &ImportedTurnKey,
) -> Result<Option<ImportedTurnStamps>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    connection
        .query_row(
            "SELECT imported_at, updated_at
                FROM imported_turns
                WHERE game_id = ?1 AND faction_id = ?2 AND turn_number = ?3",
            params![
                key.game_id.as_str(),
                key.faction_id.as_str(),
                key.turn_number
            ],
            |row| {
                Ok(ImportedTurnStamps {
                    imported_at: row.get::<_, String>(0)?,
                    updated_at: row.get::<_, String>(1)?,
                })
            },
        )
        .optional()
        .map_err(PersistenceError::from)
}

/// The turn in this game the game reopens on, if there is one.
///
/// The remembered faction's highest-numbered imported turn, falling back to the game's highest
/// turn whichever faction holds it when the manifest remembers no faction (or remembers one that
/// holds no turns). `active_faction_id` is the caller's, read from the manifest: this function is
/// given a database path rather than a game home, so it cannot read the manifest itself.
///
/// `None` means the game holds no imports, which is the ordinary state of a game just created
/// rather than a failure. Which turn wins, and the one tie-break, is
/// `atlantis_hud_core::reopen::latest_turn`'s rule; this function only hands over what the store
/// holds and loads the turn that rule names.
pub fn load_latest_imported_turn(
    database_path: &Path,
    game_id: &str,
    active_faction_id: Option<&str>,
) -> Result<Option<ImportedTurnRecord>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;

    let turns = imported_turn_refs(&connection, game_id)?;
    let Some(latest) = latest_turn(&turns, active_faction_id) else {
        return Ok(None);
    };

    load_imported_turn_from_connection(
        &connection,
        &ImportedTurnKey {
            game_id: game_id.to_string(),
            faction_id: latest.faction_id,
            turn_number: latest.turn_number,
        },
    )
}

/// Every `(faction, turn)` this game's `imported_turns` table holds, for `latest_turn` to rank.
fn imported_turn_refs(
    connection: &Connection,
    game_id: &str,
) -> Result<Vec<TurnRef>, PersistenceError> {
    let mut statement = connection
        .prepare("SELECT faction_id, turn_number FROM imported_turns WHERE game_id = ?1")?;
    let rows = statement.query_map(params![game_id], |row| {
        Ok(TurnRef {
            faction_id: row.get(0)?,
            turn_number: row.get(1)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(PersistenceError::from)
}

/// Lists every turn imported for a game, across every faction, in no particular order —
/// `@atlantis/core-client` orders the list, once for both platforms.
///
/// Keyed by game only, like [`load_latest_imported_turn`] and `export_game`: every faction's turns
/// come back, each row carrying its own `faction_id`, and the caller filters. A game with merged
/// reports legitimately holds turns for more than one faction.
///
/// A game with no imports returns an empty vector, not an error; a missing database is still an
/// error, as every other read here treats it.
pub fn list_imported_turns(
    database_path: &Path,
    game_id: &str,
) -> Result<Vec<ImportedTurnSummary>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;

    let mut statement = connection.prepare(
        "SELECT faction_id, turn_number, parsed_payload_json, imported_at, updated_at
           FROM imported_turns
          WHERE game_id = ?1",
    )?;
    let game_id_owned = game_id.to_string();
    let summaries = statement
        .query_map(params![game_id], |row| {
            let faction_id: String = row.get(0)?;
            let turn_number: u32 = row.get(1)?;
            let parsed_payload_json: String = row.get(2)?;
            let imported_at: String = row.get(3)?;
            let updated_at: String = row.get(4)?;
            Ok(ImportedTurnSummary {
                key: ImportedTurnKey {
                    game_id: game_id_owned.clone(),
                    faction_id,
                    turn_number,
                },
                season: season_from_parsed_payload(&parsed_payload_json),
                imported_at,
                updated_at,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(summaries)
}

/// Peeks the season out of a turn's parsed payload without depending on its full shape.
///
/// `parsed_payload_json` holds `ReportParseResult`, not `ReportHeaderInfo` — month and year live
/// only in the latter, which is never stored. `turn_header.season` is what survives, and reading it
/// through a tiny local struct means this has no dependency on `atlantis-core`'s types and keeps
/// working if that struct's other fields change shape. A row whose payload cannot be read this way
/// — malformed JSON, a missing `turn_header` — contributes `None` rather than failing the whole
/// list. Blobs written before ah-164.1 are snake_case (`turn_header`), later ones camelCase
/// (`turnHeader`); the peek reads both, as `ReportParseResult` itself does.
fn season_from_parsed_payload(parsed_payload_json: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct Peek {
        #[serde(rename = "turnHeader", alias = "turn_header")]
        turn_header: Option<PeekTurnHeader>,
    }
    #[derive(Deserialize)]
    struct PeekTurnHeader {
        season: Option<String>,
    }

    serde_json::from_str::<Peek>(parsed_payload_json)
        .ok()
        .and_then(|peek| peek.turn_header)
        .and_then(|header| header.season)
}

fn ensure_supported_manifest_version(version: u32) -> Result<(), PersistenceError> {
    if version <= atlantis_hud_core::backup::CURRENT_MANIFEST_VERSION {
        return Ok(());
    }

    Err(PersistenceError::UnsupportedManifestVersion {
        max_supported: atlantis_hud_core::backup::CURRENT_MANIFEST_VERSION,
        actual: version,
    })
}

fn open_database(database_path: &Path) -> Result<Connection, PersistenceError> {
    if let Some(parent_dir) = database_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    Ok(Connection::open(database_path)?)
}

/// Where one game keeps its manifest and its database.
fn game_home(games_root: &Path, game_id: &str) -> PathBuf {
    games_root.join(game_id)
}

/// Writes a manifest in place, via a temporary file, so a failed write cannot truncate the old one.
fn save_game_manifest(
    game_file_path: &Path,
    manifest: &GameManifest,
) -> Result<(), PersistenceError> {
    let temp_path = write_game_manifest_temp(game_file_path, manifest)?;
    if let Err(error) = fs::rename(&temp_path, game_file_path) {
        cleanup_file_if_exists(&temp_path);
        return Err(PersistenceError::Io(error));
    }
    Ok(())
}

fn write_game_manifest_temp(
    game_file_path: &Path,
    manifest: &GameManifest,
) -> Result<PathBuf, PersistenceError> {
    if let Some(parent_dir) = game_file_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    let serialized = serde_json::to_vec_pretty(manifest)?;
    let temp_path = game_file_path.with_extension("json.tmp");
    fs::write(&temp_path, serialized)?;
    Ok(temp_path)
}

fn load_game_manifest(game_file_path: &Path) -> Result<GameManifest, PersistenceError> {
    let content = fs::read(game_file_path)?;
    Ok(serde_json::from_slice::<GameManifest>(&content)?)
}

fn sidecar_database_path(game_file_path: &Path) -> PathBuf {
    let stem = game_file_path.file_stem().map_or_else(
        || "game".to_string(),
        |value| value.to_string_lossy().to_string(),
    );
    game_file_path.with_file_name(format!("{stem}.sqlite"))
}

fn apply_migrations(connection: &mut Connection) -> Result<(), PersistenceError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )?;

    let current = current_schema_version(connection)?;
    for migration in MIGRATIONS
        .iter()
        .filter(|migration| migration.version > current)
    {
        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            params![migration.version],
        )?;
        transaction.commit()?;
    }

    Ok(())
}

fn current_schema_version(connection: &Connection) -> Result<u32, PersistenceError> {
    let version = connection
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get::<_, Option<i64>>(0)
        })
        .optional()?
        .flatten()
        .unwrap_or(0);

    Ok(version as u32)
}

fn current_schema_version_read_only(connection: &Connection) -> Result<u32, PersistenceError> {
    let has_migrations_table = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
        )",
        [],
        |row| row.get::<_, i64>(0),
    )?;

    if has_migrations_table == 0 {
        return Ok(0);
    }

    current_schema_version(connection)
}

fn persist_game_snapshot(
    connection: &mut Connection,
    manifest: &GameManifest,
) -> Result<(), PersistenceError> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM game_metadata", [])?;
    transaction.execute("DELETE FROM report_sources", [])?;
    transaction.execute(
        "INSERT INTO game_metadata (game_id, game_name, manifest_version, ruleset_id)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            manifest.metadata.game_id.as_str(),
            manifest.metadata.game_name.as_str(),
            manifest.manifest_version,
            manifest.metadata.ruleset_id.as_str()
        ],
    )?;

    for source in &manifest.report_sources {
        transaction.execute(
            "INSERT INTO report_sources (source_id, label) VALUES (?1, ?2)",
            params![source.source_id.as_str(), source.label.as_str()],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

fn cleanup_file_if_exists(path: &Path) {
    if path.exists() {
        let _ = fs::remove_file(path);
    }
}

fn load_imported_turn_from_connection(
    connection: &Connection,
    key: &ImportedTurnKey,
) -> Result<Option<ImportedTurnRecord>, PersistenceError> {
    connection
        .query_row(
            "SELECT game_id, faction_id, turn_number, raw_report, parsed_payload_json, warnings_payload_json
                FROM imported_turns
                WHERE game_id = ?1 AND faction_id = ?2 AND turn_number = ?3",
            params![key.game_id.as_str(), key.faction_id.as_str(), key.turn_number],
            |row| {
                Ok(ImportedTurnRecord {
                    key: ImportedTurnKey {
                        game_id: row.get::<_, String>(0)?,
                        faction_id: row.get::<_, String>(1)?,
                        turn_number: row.get::<_, u32>(2)?,
                    },
                    raw_report: row.get::<_, String>(3)?,
                    parsed_payload_json: row.get::<_, String>(4)?,
                    warnings_payload_json: row.get::<_, String>(5)?,
                })
            },
        )
        .optional()
        .map_err(PersistenceError::from)
}

/// Records regions seen in one turn, keeping the most recent sighting of each.
///
/// Writes every row it is given, replacing what is stored for the same `(game, faction, region)`.
/// Which sightings survive an older report is decided in the core - `import_writes` for an
/// import, `merge_report_into_sightings` for a merge - not here.
pub fn upsert_region_sightings(
    database_path: &Path,
    game_id: &str,
    faction_id: &str,
    sightings: &[RegionSighting],
) -> Result<(), PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    let transaction = connection.transaction()?;

    for sighting in sightings {
        transaction.execute(
            "INSERT INTO region_sightings (
                game_id, faction_id, region_id, x, y, z, terrain, province, label,
                last_seen_turn, payload_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(game_id, faction_id, region_id) DO UPDATE SET
                x = excluded.x,
                y = excluded.y,
                z = excluded.z,
                terrain = excluded.terrain,
                province = excluded.province,
                label = excluded.label,
                last_seen_turn = excluded.last_seen_turn,
                payload_json = excluded.payload_json",
            params![
                game_id,
                faction_id,
                sighting.region_id.as_str(),
                sighting.x,
                sighting.y,
                sighting.z,
                sighting.terrain.as_str(),
                sighting.province.as_str(),
                sighting.label.as_str(),
                sighting.last_seen_turn,
                sighting.payload_json.as_str(),
            ],
        )?;
    }

    transaction.commit()?;
    Ok(())
}

/// Loads every region known to a faction, most recently seen first.
pub fn load_region_sightings(
    database_path: &Path,
    game_id: &str,
    faction_id: &str,
) -> Result<Vec<RegionSighting>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;

    let mut statement = connection.prepare(
        "SELECT region_id, x, y, z, terrain, province, label, last_seen_turn, payload_json
            FROM region_sightings
            WHERE game_id = ?1 AND faction_id = ?2
            ORDER BY last_seen_turn DESC, region_id ASC",
    )?;

    let rows = statement.query_map(params![game_id, faction_id], |row| {
        Ok(RegionSighting {
            region_id: row.get(0)?,
            x: row.get(1)?,
            y: row.get(2)?,
            z: row.get(3)?,
            terrain: row.get(4)?,
            province: row.get(5)?,
            label: row.get(6)?,
            last_seen_turn: row.get(7)?,
            payload_json: row.get(8)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(PersistenceError::from)
}

/// Records that an allied report was folded into a faction's map.
///
/// Merging the same ally again re-stamps the row rather than adding a second one: a merge is a
/// statement about whose sightings are in the map, and doing it twice does not put them in twice.
///
/// # Errors
///
/// Returns an error when the database file is missing or cannot be written.
pub fn upsert_merged_report(
    database_path: &Path,
    record: &MergedReportRecord,
) -> Result<(), PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;

    connection.execute(
        "INSERT INTO merged_reports (
            game_id, faction_id, turn_number, merged_faction_id, merged_faction_name, merged_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(game_id, faction_id, turn_number, merged_faction_id) DO UPDATE SET
            merged_faction_name = excluded.merged_faction_name,
            merged_at = excluded.merged_at",
        params![
            record.game_id.as_str(),
            record.faction_id.as_str(),
            record.turn_number,
            record.merged_faction_id.as_str(),
            record.merged_faction_name.as_str(),
            record.merged_at.as_str(),
        ],
    )?;

    Ok(())
}

/// Every allied report folded into one faction's map for one turn, in the order they were merged.
///
/// # Errors
///
/// Returns an error when the database file is missing or cannot be read.
pub fn load_merged_reports(
    database_path: &Path,
    game_id: &str,
    faction_id: &str,
    turn_number: u32,
) -> Result<Vec<MergedReportRecord>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;

    let mut statement = connection.prepare(
        "SELECT merged_faction_id, merged_faction_name, merged_at
            FROM merged_reports
            WHERE game_id = ?1 AND faction_id = ?2 AND turn_number = ?3
            ORDER BY merged_at ASC, merged_faction_id ASC",
    )?;

    let rows = statement.query_map(params![game_id, faction_id, turn_number], |row| {
        Ok(MergedReportRecord {
            game_id: game_id.to_string(),
            faction_id: faction_id.to_string(),
            turn_number,
            merged_faction_id: row.get(0)?,
            merged_faction_name: row.get(1)?,
            merged_at: row.get(2)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(PersistenceError::from)
}

/// Inserts or updates one persisted order draft.
pub fn upsert_order_draft(
    database_path: &Path,
    record: &OrderDraftRecord,
) -> Result<(), PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    connection.execute(
        "INSERT INTO order_drafts (
            game_id,
            faction_id,
            turn_number,
            order_text,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(game_id, faction_id, turn_number) DO UPDATE SET
            order_text = excluded.order_text,
            updated_at = excluded.updated_at",
        params![
            record.key.game_id.as_str(),
            record.key.faction_id.as_str(),
            record.key.turn_number,
            record.order_text.as_str(),
            record.updated_at.as_str(),
        ],
    )?;
    Ok(())
}

/// Loads one persisted order draft by composite key.
pub fn load_order_draft(
    database_path: &Path,
    key: &OrderDraftKey,
) -> Result<Option<OrderDraftRecord>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    connection
        .query_row(
            "SELECT game_id, faction_id, turn_number, order_text, updated_at
                FROM order_drafts
                WHERE game_id = ?1 AND faction_id = ?2 AND turn_number = ?3",
            params![
                key.game_id.as_str(),
                key.faction_id.as_str(),
                key.turn_number
            ],
            |row| {
                Ok(OrderDraftRecord {
                    key: OrderDraftKey {
                        game_id: row.get::<_, String>(0)?,
                        faction_id: row.get::<_, String>(1)?,
                        turn_number: row.get::<_, u32>(2)?,
                    },
                    order_text: row.get::<_, String>(3)?,
                    updated_at: row.get::<_, String>(4)?,
                })
            },
        )
        .optional()
        .map_err(PersistenceError::from)
}

/// Inserts or updates one persisted hex note. An edit keeps its original `created_at`.
pub fn upsert_hex_note(database_path: &Path, note: &HexNote) -> Result<(), PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    connection.execute(
        "INSERT INTO hex_notes (
            id,
            game_id,
            region_id,
            text,
            on_map,
            turn,
            created_at,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            region_id = excluded.region_id,
            text = excluded.text,
            on_map = excluded.on_map,
            turn = excluded.turn,
            updated_at = excluded.updated_at",
        params![
            note.id.as_str(),
            note.game_id.as_str(),
            note.region_id.as_str(),
            note.text.as_str(),
            i64::from(note.on_map),
            note.turn,
            note.created_at.as_str(),
            note.updated_at.as_str(),
        ],
    )?;
    Ok(())
}

/// Lists a game's hex notes, in no particular order — the client orders them.
pub fn list_hex_notes(
    database_path: &Path,
    game_id: &str,
) -> Result<Vec<HexNote>, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    let mut statement = connection.prepare(
        "SELECT id, game_id, region_id, text, on_map, turn, created_at, updated_at
           FROM hex_notes
          WHERE game_id = ?1",
    )?;
    let rows = statement.query_map(params![game_id], |row| {
        Ok(HexNote {
            id: row.get(0)?,
            game_id: row.get(1)?,
            region_id: row.get(2)?,
            text: row.get(3)?,
            on_map: row.get::<_, i64>(4)? != 0,
            turn: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(PersistenceError::from)
}

/// Deletes one hex note; `Ok(true)` when a row existed, `Ok(false)` otherwise.
pub fn delete_hex_note(
    database_path: &Path,
    game_id: &str,
    note_id: &str,
) -> Result<bool, PersistenceError> {
    if !database_path.exists() {
        return Err(PersistenceError::DatabaseFileMissing(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let mut connection = open_database(database_path)?;
    apply_migrations(&mut connection)?;
    let rows_affected = connection.execute(
        "DELETE FROM hex_notes WHERE game_id = ?1 AND id = ?2",
        params![game_id, note_id],
    )?;
    Ok(rows_affected > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    const GAME_ID: &str = "faction-12";
    const CREATED_AT: &str = "2026-08-01T09:00:00Z";
    const IMPORTED_AT: &str = "2026-08-01T10:00:00Z";

    fn fixture_manifest() -> GameManifest {
        manifest_named(GAME_ID, "Faction 12 - Spring 12")
    }

    fn manifest_named(game_id: &str, game_name: &str) -> GameManifest {
        GameManifest {
            manifest_version: 1,
            metadata: GameMetadata {
                game_id: game_id.to_string(),
                game_name: game_name.to_string(),
                ruleset_id: "neworigins".to_string(),
                active_faction_id: None,
            },
            report_sources: vec![
                ReportSourceRef {
                    source_id: "turn-12-report".to_string(),
                    label: "Turn 12 report".to_string(),
                },
                ReportSourceRef {
                    source_id: "turn-12-appendix".to_string(),
                    label: "Turn 12 appendix".to_string(),
                },
            ],
            created_at: CREATED_AT.to_string(),
            last_opened_at: CREATED_AT.to_string(),
        }
    }

    fn turn_in(game: &OpenedGame, faction_id: &str, raw: &str) -> ImportedTurnRecord {
        ImportedTurnRecord {
            key: ImportedTurnKey {
                game_id: game.manifest.metadata.game_id.clone(),
                faction_id: faction_id.to_string(),
                turn_number: 12,
            },
            raw_report: raw.to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
        }
    }

    #[test]
    fn a_game_gets_a_directory_of_its_own() {
        let dir = tempdir().expect("tempdir");

        let created =
            create_game(dir.path(), &fixture_manifest()).expect("creation should succeed");

        let home = dir.path().join(GAME_ID);
        assert!(home.is_dir(), "the game should own a directory");
        assert!(home.join(GAME_MANIFEST_FILE_NAME).exists());
        assert_eq!(created.database_path, home.join("game.sqlite"));
        assert!(created.database_path.exists());
        assert_eq!(created.schema_version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn listing_finds_every_game_that_was_created() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &manifest_named("alpha", "Alpha")).expect("alpha");
        create_game(dir.path(), &manifest_named("beta", "Beta")).expect("beta");

        let mut listed: Vec<String> = list_games(dir.path())
            .expect("listing should succeed")
            .into_iter()
            .map(|manifest| manifest.metadata.game_id)
            .collect();
        listed.sort();

        assert_eq!(listed, vec!["alpha".to_string(), "beta".to_string()]);
    }

    /// A player with no games yet is the ordinary first-run case, not a failure.
    #[test]
    fn listing_a_root_that_does_not_exist_yet_is_empty() {
        let dir = tempdir().expect("tempdir");

        let listed = list_games(&dir.path().join("never-created")).expect("listing should succeed");

        assert!(listed.is_empty());
    }

    /// One unreadable game must not hide the others.
    ///
    /// The alternative - failing the whole listing - would leave a player who cannot be told which
    /// game is broken unable to reach any of the games that are fine.
    #[test]
    fn listing_skips_a_game_whose_manifest_cannot_be_read() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &manifest_named("good", "Good")).expect("good");

        let broken = dir.path().join("broken");
        fs::create_dir_all(&broken).expect("broken dir");
        fs::write(broken.join(GAME_MANIFEST_FILE_NAME), b"{ not json").expect("broken manifest");

        let listed = list_games(dir.path()).expect("listing should succeed");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].metadata.game_id, "good");
    }

    /// Which game reopens on the next launch is decided by this stamp, so opening has to move it.
    #[test]
    fn opening_a_game_stamps_when_it_was_last_opened() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &fixture_manifest()).expect("creation should succeed");

        let reopened =
            open_game(dir.path(), GAME_ID, "2026-08-09T18:30:00Z").expect("reopen should succeed");

        assert_eq!(reopened.manifest.last_opened_at, "2026-08-09T18:30:00Z");
        assert_eq!(reopened.manifest.created_at, CREATED_AT);

        // The stamp has to survive on disk, not just in the value handed back.
        let listed = list_games(dir.path()).expect("listing should succeed");
        assert_eq!(listed[0].last_opened_at, "2026-08-09T18:30:00Z");
    }

    #[test]
    fn a_game_remembers_which_ruleset_it_is_played_under() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &fixture_manifest()).expect("creation should succeed");

        let reopened = open_game(dir.path(), GAME_ID, CREATED_AT).expect("reopen should succeed");

        assert_eq!(reopened.manifest.metadata.ruleset_id, "neworigins");

        let stored: String = Connection::open(&reopened.database_path)
            .expect("db should open")
            .query_row("SELECT ruleset_id FROM game_metadata", [], |row| row.get(0))
            .expect("the ruleset should be mirrored into the database");
        assert_eq!(stored, "neworigins");
    }

    /// The settings dialog lets a player change rulesets after creation, so the change must land
    /// in both places the id lives: the manifest the frontends read, and the row the database
    /// mirrors it into.
    #[test]
    fn changing_a_games_ruleset_updates_manifest_and_database() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &fixture_manifest()).expect("creation should succeed");

        let updated = set_game_ruleset(dir.path(), GAME_ID, "magicdeep")
            .expect("the ruleset change should succeed");
        assert_eq!(updated.metadata.ruleset_id, "magicdeep");

        let reopened = open_game(dir.path(), GAME_ID, CREATED_AT).expect("reopen should succeed");
        assert_eq!(reopened.manifest.metadata.ruleset_id, "magicdeep");

        let stored: String = Connection::open(&reopened.database_path)
            .expect("db should open")
            .query_row("SELECT ruleset_id FROM game_metadata", [], |row| row.get(0))
            .expect("the ruleset should be mirrored into the database");
        assert_eq!(stored, "magicdeep");
    }

    #[test]
    fn changing_the_ruleset_of_a_missing_game_names_it() {
        let dir = tempdir().expect("tempdir");

        let error = set_game_ruleset(dir.path(), "no-such-game", "magicdeep")
            .expect_err("changing a missing game should fail");

        assert!(matches!(error, PersistenceError::GameNotFound(ref id) if id == "no-such-game"));
    }

    /// The This game panel lets a player rename their game after creation, so the change must land
    /// in both places the name lives: the manifest the frontends read, and the row the database
    /// mirrors it into.
    #[test]
    fn renaming_a_game_updates_manifest_and_database() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &fixture_manifest()).expect("creation should succeed");

        let updated = set_game_name(dir.path(), GAME_ID, "Binding of the North")
            .expect("the rename should succeed");
        assert_eq!(updated.metadata.game_name, "Binding of the North");

        let reopened = open_game(dir.path(), GAME_ID, CREATED_AT).expect("reopen should succeed");
        assert_eq!(reopened.manifest.metadata.game_name, "Binding of the North");

        let stored: String = Connection::open(&reopened.database_path)
            .expect("db should open")
            .query_row("SELECT game_name FROM game_metadata", [], |row| row.get(0))
            .expect("the name should be mirrored into the database");
        assert_eq!(stored, "Binding of the North");
    }

    #[test]
    fn the_active_faction_is_remembered_across_reopening() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &fixture_manifest()).expect("creation should succeed");

        let updated = set_active_faction(dir.path(), GAME_ID, "95")
            .expect("recording the active faction should succeed");
        assert_eq!(updated.metadata.active_faction_id, Some("95".to_string()));

        let reopened = open_game(dir.path(), GAME_ID, CREATED_AT).expect("reopen should succeed");
        assert_eq!(
            reopened.manifest.metadata.active_faction_id,
            Some("95".to_string())
        );
    }

    #[test]
    fn setting_the_active_faction_of_a_game_that_does_not_exist_is_an_error() {
        let dir = tempdir().expect("tempdir");

        let error = set_active_faction(dir.path(), "no-such-game", "95")
            .expect_err("setting the active faction of a missing game should fail");

        assert!(matches!(error, PersistenceError::GameNotFound(ref id) if id == "no-such-game"));
    }

    #[test]
    fn renaming_a_missing_game_names_it() {
        let dir = tempdir().expect("tempdir");

        let error = set_game_name(dir.path(), "no-such-game", "Binding of the North")
            .expect_err("renaming a missing game should fail");

        assert!(matches!(error, PersistenceError::GameNotFound(ref id) if id == "no-such-game"));
    }

    #[test]
    fn opening_a_game_that_is_not_there_names_it() {
        let dir = tempdir().expect("tempdir");

        let error = open_game(dir.path(), "no-such-game", CREATED_AT)
            .expect_err("opening a missing game should fail");

        assert!(matches!(error, PersistenceError::GameNotFound(ref id) if id == "no-such-game"));
    }

    /// Deleting a game must take its database with it, and leave every other game alone.
    #[test]
    fn deleting_a_game_takes_its_database_and_nothing_else() {
        let dir = tempdir().expect("tempdir");
        let doomed = create_game(dir.path(), &manifest_named("doomed", "Doomed")).expect("doomed");
        let kept = create_game(dir.path(), &manifest_named("kept", "Kept")).expect("kept");
        upsert_imported_turn(
            &doomed.database_path,
            &turn_in(&doomed, "17", "doomed turn"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed doomed");
        upsert_imported_turn(
            &kept.database_path,
            &turn_in(&kept, "17", "kept turn"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed kept");

        delete_game(dir.path(), "doomed").expect("deletion should succeed");

        assert!(!dir.path().join("doomed").exists());
        assert!(!doomed.database_path.exists());

        let survivor = load_imported_turn(&kept.database_path, &turn_in(&kept, "17", "").key)
            .expect("load should succeed")
            .expect("the other game's turn should be untouched");
        assert_eq!(survivor.raw_report, "kept turn");
    }

    #[test]
    fn deleting_a_game_that_is_not_there_names_it() {
        let dir = tempdir().expect("tempdir");

        let error = delete_game(dir.path(), "no-such-game")
            .expect_err("deleting a missing game should fail");

        assert!(matches!(error, PersistenceError::GameNotFound(ref id) if id == "no-such-game"));
    }

    /// The point of a database per game: what one game imported is invisible to the other.
    #[test]
    fn two_games_cannot_see_each_others_turns() {
        let dir = tempdir().expect("tempdir");
        let alpha = create_game(dir.path(), &manifest_named("alpha", "Alpha")).expect("alpha");
        let beta = create_game(dir.path(), &manifest_named("beta", "Beta")).expect("beta");

        upsert_imported_turn(
            &alpha.database_path,
            &turn_in(&alpha, "17", "alpha turn"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed alpha");

        let seen_from_beta =
            load_imported_turn(&beta.database_path, &turn_in(&alpha, "17", "").key)
                .expect("load should succeed");

        assert_eq!(seen_from_beta, None);
    }

    #[test]
    fn creating_a_game_twice_under_one_id_fails() {
        let dir = tempdir().expect("tempdir");
        create_game(dir.path(), &fixture_manifest()).expect("first creation should succeed");

        let error = create_game(dir.path(), &fixture_manifest())
            .expect_err("a second game under the same id should fail");

        assert!(matches!(error, PersistenceError::GameFileAlreadyExists(_)));
    }

    /// A database written before games had a name of their own must keep its turns.
    ///
    /// The rename is a schema change, not a fresh start. A player who imported turns while the
    /// column was called `project_id` has to find them under `game_id` afterwards, or the rename
    /// has quietly eaten a season of reports.
    ///
    /// The v4 schema is built from the migration constants themselves rather than from a copy of
    /// their DDL, so this test cannot drift away from the schema it claims to describe.
    #[test]
    fn upgrading_from_version_four_keeps_imported_turns() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let home = dir.path().join(GAME_ID);
        fs::create_dir_all(&home).expect("game home");
        save_game_manifest(&home.join(GAME_MANIFEST_FILE_NAME), &manifest)
            .expect("manifest save should succeed");

        let database_path = home.join("game.sqlite");
        let connection = Connection::open(&database_path).expect("db should open");
        connection
            .execute_batch(&format!(
                "{MIGRATION_0001_INITIAL}
                 {MIGRATION_0002_IMPORTED_TURNS}
                 {MIGRATION_0003_ORDER_DRAFTS}
                 {MIGRATION_0004_REGION_SIGHTINGS}
                 INSERT INTO schema_migrations (version) VALUES (1), (2), (3), (4);
                 INSERT INTO imported_turns
                     (project_id, faction_id, turn_number, raw_report,
                      parsed_payload_json, warnings_payload_json)
                 VALUES ('faction-12', '95', 71, 'raw report', '{{}}', '[]');"
            ))
            .expect("legacy version 4 setup should succeed");
        drop(connection);

        let reopened = open_game(dir.path(), GAME_ID, CREATED_AT).expect("upgrade should succeed");

        assert_eq!(reopened.schema_version, CURRENT_SCHEMA_VERSION);

        let record = load_imported_turn(
            &reopened.database_path,
            &ImportedTurnKey {
                game_id: "faction-12".to_string(),
                faction_id: "95".to_string(),
                turn_number: 71,
            },
        )
        .expect("load should succeed")
        .expect("the turn imported before the rename should still be there");

        assert_eq!(record.raw_report, "raw report");
    }

    #[test]
    fn open_game_reuses_saved_manifest_and_schema() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();

        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");
        let reopened =
            open_game(dir.path(), GAME_ID, CREATED_AT).expect("game reopen should succeed");

        assert_eq!(reopened.manifest, created.manifest);
        assert_eq!(reopened.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            schema_version(&reopened.database_path).expect("schema read should succeed"),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn open_game_upgrades_existing_database_schema() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let home = dir.path().join(GAME_ID);
        fs::create_dir_all(&home).expect("game home");
        save_game_manifest(&home.join(GAME_MANIFEST_FILE_NAME), &manifest)
            .expect("manifest save should succeed");
        let database_path = home.join("game.sqlite");
        let connection = Connection::open(&database_path).expect("db should open");
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 INSERT INTO schema_migrations (version) VALUES (0);",
            )
            .expect("legacy schema setup should succeed");

        let reopened = open_game(dir.path(), GAME_ID, CREATED_AT).expect("upgrade should succeed");

        assert_eq!(reopened.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            schema_version(&reopened.database_path).expect("schema read should succeed"),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn schema_version_fails_for_missing_database_file() {
        let dir = tempdir().expect("tempdir");
        let missing_path = dir.path().join("missing.sqlite");

        let error = schema_version(&missing_path).expect_err("missing database should fail");
        assert!(matches!(error, PersistenceError::DatabaseFileMissing(_)));
    }

    /// A leftover database under a fresh game's id must not be adopted silently.
    #[test]
    fn create_game_fails_when_a_database_is_already_sitting_there() {
        let dir = tempdir().expect("tempdir");
        let home = dir.path().join(GAME_ID);
        fs::create_dir_all(&home).expect("game home");
        fs::write(home.join("game.sqlite"), b"existing database").expect("seed existing db file");

        let error =
            create_game(dir.path(), &fixture_manifest()).expect_err("existing db should fail");
        assert!(matches!(error, PersistenceError::DatabaseAlreadyExists(_)));
    }

    #[test]
    fn imported_turn_can_be_inserted_and_loaded() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");

        let record = ImportedTurnRecord {
            key: ImportedTurnKey {
                game_id: manifest.metadata.game_id.clone(),
                faction_id: "17".to_string(),
                turn_number: 12,
            },
            raw_report: "TURN: 12 Spring".to_string(),
            parsed_payload_json: "{\"turn\":12}".to_string(),
            warnings_payload_json: "[]".to_string(),
        };

        upsert_imported_turn(&created.database_path, &record, IMPORTED_AT, IMPORTED_AT)
            .expect("import should persist");
        let loaded =
            load_imported_turn(&created.database_path, &record.key).expect("load should succeed");

        assert_eq!(loaded, Some(record));
    }

    #[test]
    fn imported_turn_preview_reports_diff_for_duplicate() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");

        let key = ImportedTurnKey {
            game_id: manifest.metadata.game_id.clone(),
            faction_id: "17".to_string(),
            turn_number: 12,
        };
        let original = ImportedTurnRecord {
            key: key.clone(),
            raw_report: "TURN: 12 Spring".to_string(),
            parsed_payload_json: "{\"turn\":12,\"regions\":1}".to_string(),
            warnings_payload_json: "[]".to_string(),
        };
        upsert_imported_turn(&created.database_path, &original, IMPORTED_AT, IMPORTED_AT)
            .expect("seed import");

        let candidate = ImportedTurnRecord {
            key,
            raw_report: "TURN: 12 Spring -- updated".to_string(),
            parsed_payload_json: "{\"turn\":12,\"regions\":2}".to_string(),
            warnings_payload_json: "[{\"code\":\"unit-malformed-line\"}]".to_string(),
        };
        let preview = preview_imported_turn(&created.database_path, &candidate)
            .expect("preview should succeed");

        assert_eq!(
            preview,
            ImportedTurnPreview {
                exists: true,
                raw_changed: true,
                parsed_changed: true,
                warnings_changed: true,
            }
        );
    }

    #[test]
    fn insert_imported_turn_fails_for_duplicate_key() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");

        let record = ImportedTurnRecord {
            key: ImportedTurnKey {
                game_id: manifest.metadata.game_id.clone(),
                faction_id: "17".to_string(),
                turn_number: 12,
            },
            raw_report: "TURN: 12 Spring".to_string(),
            parsed_payload_json: "{\"turn\":12}".to_string(),
            warnings_payload_json: "[]".to_string(),
        };

        insert_imported_turn(&created.database_path, &record, IMPORTED_AT, IMPORTED_AT)
            .expect("first insert should succeed");
        let duplicate_error =
            insert_imported_turn(&created.database_path, &record, IMPORTED_AT, IMPORTED_AT)
                .expect_err("duplicate insert should fail");
        assert!(matches!(
            duplicate_error,
            PersistenceError::DuplicateImportedTurn { .. }
        ));
    }

    #[test]
    fn order_draft_round_trips_through_persistence() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");

        let draft = OrderDraftRecord {
            key: OrderDraftKey {
                game_id: manifest.metadata.game_id.clone(),
                faction_id: "17".to_string(),
                turn_number: 12,
            },
            order_text: "MOVE U100 R2".to_string(),
            updated_at: "2026-08-07T12:00:00Z".to_string(),
        };

        upsert_order_draft(&created.database_path, &draft).expect("draft should persist");
        let loaded =
            load_order_draft(&created.database_path, &draft.key).expect("draft should load");

        assert_eq!(loaded, Some(draft));
    }

    #[test]
    fn schema_version_tracks_the_latest_migration() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();

        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");

        assert_eq!(created.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            created.schema_version, 8,
            "storing manual hex notes added migration 8"
        );
    }

    #[test]
    fn hex_note_round_trips_and_lists_every_note() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");

        let older = HexNote {
            id: "note-older".to_string(),
            game_id: GAME_ID.to_string(),
            region_id: "1:7,53".to_string(),
            text: "First note".to_string(),
            on_map: true,
            turn: 12,
            created_at: "2026-08-01T09:00:00Z".to_string(),
            updated_at: "2026-08-01T09:00:00Z".to_string(),
        };
        let newer = HexNote {
            id: "note-newer".to_string(),
            game_id: GAME_ID.to_string(),
            region_id: "1:7,53".to_string(),
            text: "Second note".to_string(),
            on_map: false,
            turn: 13,
            created_at: "2026-08-02T09:00:00Z".to_string(),
            updated_at: "2026-08-02T09:00:00Z".to_string(),
        };
        upsert_hex_note(&created.database_path, &older).expect("older note should persist");
        upsert_hex_note(&created.database_path, &newer).expect("newer note should persist");

        let mut listed =
            list_hex_notes(&created.database_path, GAME_ID).expect("list should succeed");
        listed.sort_by(|a, b| a.id.cmp(&b.id));
        let mut expected = vec![newer.clone(), older.clone()];
        expected.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(
            listed, expected,
            "every note is listed; order is the client's concern"
        );

        let edited = HexNote {
            text: "First note, edited".to_string(),
            updated_at: "2026-08-03T09:00:00Z".to_string(),
            ..older.clone()
        };
        upsert_hex_note(&created.database_path, &edited).expect("edit should persist");
        let listed_after_edit =
            list_hex_notes(&created.database_path, GAME_ID).expect("list should succeed");
        let edited_note = listed_after_edit
            .iter()
            .find(|note| note.id == older.id)
            .expect("the edited note is listed");
        assert_eq!(
            edited_note.created_at, older.created_at,
            "an edit must not move created_at"
        );
        assert_eq!(edited_note.text, "First note, edited");

        assert!(
            delete_hex_note(&created.database_path, GAME_ID, "note-older")
                .expect("delete should succeed"),
            "deleting an existing note reports true"
        );
        assert!(
            !delete_hex_note(&created.database_path, GAME_ID, "note-older")
                .expect("delete should succeed"),
            "deleting an already-deleted note reports false"
        );
        let listed_after_delete =
            list_hex_notes(&created.database_path, GAME_ID).expect("list should succeed");
        assert_eq!(listed_after_delete.len(), 1);
    }

    /// The store writes whatever two stamps it is given, on both the first import and a
    /// re-import - it keeps nothing back. Keeping `imported_at` across a re-import is the core's
    /// rule (`import_writes`), not this store's.
    #[test]
    fn the_store_writes_both_stamps_it_is_given_and_keeps_neither_back() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");
        let record = turn_in(&created, "17", "TURN: 12 Spring");

        upsert_imported_turn(&created.database_path, &record, IMPORTED_AT, IMPORTED_AT)
            .expect("seed import");
        assert_eq!(
            load_imported_turn_stamps(&created.database_path, &record.key)
                .expect("load should succeed")
                .expect("stamps should exist"),
            ImportedTurnStamps {
                imported_at: IMPORTED_AT.to_string(),
                updated_at: IMPORTED_AT.to_string(),
            }
        );

        let corrected_imported_at = "2026-08-02T11:30:00Z";
        let corrected_updated_at = "2026-08-02T12:00:00Z";
        upsert_imported_turn(
            &created.database_path,
            &turn_in(&created, "17", "TURN: 12 Spring -- corrected"),
            corrected_imported_at,
            corrected_updated_at,
        )
        .expect("re-import");

        assert_eq!(
            load_imported_turn_stamps(&created.database_path, &record.key)
                .expect("load should succeed")
                .expect("stamps should exist"),
            ImportedTurnStamps {
                imported_at: corrected_imported_at.to_string(),
                updated_at: corrected_updated_at.to_string(),
            }
        );
    }

    #[test]
    fn stamps_of_a_turn_never_imported_are_none() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");
        let record = turn_in(&created, "17", "TURN: 12 Spring");

        let stamps = load_imported_turn_stamps(&created.database_path, &record.key)
            .expect("load should succeed");

        assert_eq!(stamps, None);
    }

    /// A database written before migration 6 has SQLite's own format in it, and comparing that
    /// against an order draft's ISO string is wrong at character ten. The migration rewrites it.
    #[test]
    fn timestamps_written_before_the_migration_are_rewritten_as_iso() {
        let dir = tempdir().expect("tempdir");
        let manifest = fixture_manifest();
        let created = create_game(dir.path(), &manifest).expect("game creation should succeed");
        let record = turn_in(&created, "17", "TURN: 12 Spring");
        upsert_imported_turn(&created.database_path, &record, IMPORTED_AT, IMPORTED_AT)
            .expect("seed import");

        // Put the database back the way an earlier build left it, migration rows included, so the
        // rewrite has to run rather than being skipped as already applied. Everything from 6 up
        // goes, because migrations are replayed from the highest version recorded: leaving a later
        // row behind would keep this one skipped and quietly stop testing anything.
        let connection = Connection::open(&created.database_path).expect("open");
        connection
            .execute_batch(
                "UPDATE imported_turns
                    SET imported_at = '2026-08-01 10:00:00',
                        updated_at  = '2026-08-01 10:00:00';
                 DELETE FROM schema_migrations WHERE version >= 6;",
            )
            .expect("rewind");
        drop(connection);

        open_game(dir.path(), &manifest.metadata.game_id, CREATED_AT).expect("reopen migrates");

        assert_eq!(
            load_imported_turn_stamps(&created.database_path, &record.key)
                .expect("load should succeed")
                .expect("stamps should exist"),
            ImportedTurnStamps {
                imported_at: IMPORTED_AT.to_string(),
                updated_at: IMPORTED_AT.to_string(),
            }
        );
    }

    /// The ordinary state of a game just created. Nothing to reopen is not something going wrong.
    #[test]
    fn a_game_with_no_imports_has_no_latest_turn() {
        let dir = tempdir().expect("tempdir");
        let created =
            create_game(dir.path(), &fixture_manifest()).expect("game creation should succeed");

        let latest = load_latest_imported_turn(&created.database_path, GAME_ID, None)
            .expect("the query should succeed");

        assert_eq!(latest, None);
    }

    /// The reported defect: import turn 25, then turn 23, and reopening must still be 25.
    ///
    /// A draft written on the older turn does not change that - nothing about reopening reads a
    /// stamp any more, so the later import of an earlier turn cannot take the game back in time.
    #[test]
    fn reopening_never_goes_back_to_an_older_turn() {
        let dir = tempdir().expect("tempdir");
        let created =
            create_game(dir.path(), &fixture_manifest()).expect("game creation should succeed");

        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "17", 25, "the current turn"),
            "2026-08-09T18:00:00Z",
            "2026-08-09T18:00:00Z",
        )
        .expect("seed turn 25");
        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "17", 23, "an old report imported for history"),
            "2026-08-09T19:00:00Z",
            "2026-08-09T19:00:00Z",
        )
        .expect("seed turn 23");

        upsert_order_draft(
            &created.database_path,
            &OrderDraftRecord {
                key: OrderDraftKey {
                    game_id: GAME_ID.to_string(),
                    faction_id: "17".to_string(),
                    turn_number: 23,
                },
                order_text: "MOVE U100 R2".to_string(),
                updated_at: "2026-08-09T22:00:00Z".to_string(),
            },
        )
        .expect("the draft should persist");

        let latest = load_latest_imported_turn(&created.database_path, GAME_ID, None)
            .expect("the query should succeed")
            .expect("there is a turn to come back to");

        assert_eq!(latest.key.turn_number, 25);
        assert_eq!(latest.raw_report, "the current turn");
    }

    /// Two factions holding the same turn: the remembered one is the one that reopens.
    #[test]
    fn the_remembered_faction_decides_which_turn_reopens() {
        let dir = tempdir().expect("tempdir");
        let created =
            create_game(dir.path(), &fixture_manifest()).expect("game creation should succeed");

        upsert_imported_turn(
            &created.database_path,
            &turn_in(&created, "17", "the ally"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed the first faction");
        upsert_imported_turn(
            &created.database_path,
            &turn_in(&created, "18", "mine"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed the second faction");

        let latest = load_latest_imported_turn(&created.database_path, GAME_ID, Some("18"))
            .expect("the query should succeed")
            .expect("there is a turn to come back to");

        assert_eq!(latest.key.faction_id, "18");
        assert_eq!(latest.raw_report, "mine");
    }

    /// The point of a database per game, asked of the new query too.
    #[test]
    fn one_games_latest_turn_is_invisible_to_another() {
        let dir = tempdir().expect("tempdir");
        let alpha = create_game(dir.path(), &manifest_named("alpha", "Alpha")).expect("alpha");
        let beta = create_game(dir.path(), &manifest_named("beta", "Beta")).expect("beta");

        upsert_imported_turn(
            &alpha.database_path,
            &turn_in(&alpha, "17", "alpha turn"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed alpha");

        assert_eq!(
            load_latest_imported_turn(&beta.database_path, "alpha", None)
                .expect("the query should succeed"),
            None
        );
        assert_eq!(
            load_latest_imported_turn(&beta.database_path, "beta", None)
                .expect("the query should succeed"),
            None
        );
    }

    fn turn_at(
        game: &OpenedGame,
        faction_id: &str,
        turn_number: u32,
        raw: &str,
    ) -> ImportedTurnRecord {
        ImportedTurnRecord {
            key: ImportedTurnKey {
                game_id: game.manifest.metadata.game_id.clone(),
                faction_id: faction_id.to_string(),
                turn_number,
            },
            raw_report: raw.to_string(),
            parsed_payload_json: "{}".to_string(),
            warnings_payload_json: "[]".to_string(),
        }
    }

    #[test]
    fn imported_turns_can_be_listed_for_a_game() {
        let dir = tempdir().expect("tempdir");
        let created = create_game(dir.path(), &fixture_manifest()).expect("game should create");

        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "17", 14, "t14"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed turn 14");
        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "17", 12, "t12"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed turn 12");
        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "17", 13, "t13"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed turn 13");

        let listed =
            list_imported_turns(&created.database_path, GAME_ID).expect("listing should succeed");

        let mut turn_numbers: Vec<u32> = listed
            .iter()
            .map(|summary| summary.key.turn_number)
            .collect();
        turn_numbers.sort_unstable();
        assert_eq!(turn_numbers, vec![12, 13, 14]);
        assert!(listed.iter().all(|summary| summary.key.faction_id == "17"));
    }

    #[test]
    fn a_game_with_no_imports_lists_no_turns() {
        let dir = tempdir().expect("tempdir");
        let created = create_game(dir.path(), &fixture_manifest()).expect("game should create");

        let listed =
            list_imported_turns(&created.database_path, GAME_ID).expect("listing should succeed");

        assert!(listed.is_empty());
    }

    /// The point of a database per game, asked of the listing too.
    #[test]
    fn one_games_turns_are_invisible_to_another() {
        let dir = tempdir().expect("tempdir");
        let alpha = create_game(dir.path(), &manifest_named("alpha", "Alpha")).expect("alpha");
        let beta = create_game(dir.path(), &manifest_named("beta", "Beta")).expect("beta");

        upsert_imported_turn(
            &alpha.database_path,
            &turn_in(&alpha, "17", "alpha turn"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed alpha");

        let listed =
            list_imported_turns(&beta.database_path, "alpha").expect("listing should succeed");

        assert!(listed.is_empty());
    }

    #[test]
    fn a_missing_database_is_an_error_not_an_empty_list() {
        let dir = tempdir().expect("tempdir");

        let result = list_imported_turns(&dir.path().join("never-created.sqlite"), GAME_ID);

        assert!(matches!(
            result,
            Err(PersistenceError::DatabaseFileMissing(_))
        ));
    }

    #[test]
    fn a_listed_turn_carries_its_season() {
        let dir = tempdir().expect("tempdir");
        let created = create_game(dir.path(), &fixture_manifest()).expect("game should create");
        let old_format = ImportedTurnRecord {
            key: ImportedTurnKey {
                turn_number: 12,
                ..turn_in(&created, "17", "t12").key
            },
            // Snake case — the old format, written before ah-164.1, still readable.
            parsed_payload_json: r#"{"turn_header":{"turn_number":12,"season":"Spring"}}"#
                .to_string(),
            ..turn_in(&created, "17", "t12")
        };
        upsert_imported_turn(
            &created.database_path,
            &old_format,
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed old-format turn");
        let new_format = ImportedTurnRecord {
            key: ImportedTurnKey {
                turn_number: 13,
                ..turn_in(&created, "17", "t13").key
            },
            // camelCase — the current format, matching what `ReportParseResult` serializes to
            // since ah-164.1.
            parsed_payload_json: r#"{"turnHeader":{"turnNumber":13,"season":"Summer"}}"#
                .to_string(),
            ..turn_in(&created, "17", "t13")
        };
        upsert_imported_turn(
            &created.database_path,
            &new_format,
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed new-format turn");

        let mut listed =
            list_imported_turns(&created.database_path, GAME_ID).expect("listing should succeed");
        listed.sort_by_key(|summary| summary.key.turn_number);

        assert_eq!(listed.len(), 2);
        let seasons: Vec<Option<&str>> = listed.iter().map(|t| t.season.as_deref()).collect();
        assert_eq!(seasons, vec![Some("Spring"), Some("Summer")]);
    }

    /// A list that dies on one bad row makes the whole feature unavailable, which matters more
    /// than any one turn's season.
    #[test]
    fn a_turn_whose_payload_cannot_be_read_is_still_listed() {
        let dir = tempdir().expect("tempdir");
        let created = create_game(dir.path(), &fixture_manifest()).expect("game should create");
        let turn = ImportedTurnRecord {
            parsed_payload_json: "not json at all".to_string(),
            ..turn_in(&created, "17", "t12")
        };
        upsert_imported_turn(&created.database_path, &turn, IMPORTED_AT, IMPORTED_AT)
            .expect("seed turn");

        let listed =
            list_imported_turns(&created.database_path, GAME_ID).expect("listing should succeed");

        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].season, None);
    }

    /// The store returns rows in no particular order; `@atlantis/core-client` orders them, once
    /// for both platforms. This pins the store's content, not its order.
    #[test]
    fn turns_of_two_factions_are_all_listed() {
        let dir = tempdir().expect("tempdir");
        let created = create_game(dir.path(), &fixture_manifest()).expect("game should create");

        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "17", 12, "a"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed 17@12");
        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "5", 12, "b"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed 5@12");
        upsert_imported_turn(
            &created.database_path,
            &turn_at(&created, "17", 13, "c"),
            IMPORTED_AT,
            IMPORTED_AT,
        )
        .expect("seed 17@13");

        let listed =
            list_imported_turns(&created.database_path, GAME_ID).expect("listing should succeed");

        let mut pairs: Vec<(u32, String)> = listed
            .iter()
            .map(|summary| (summary.key.turn_number, summary.key.faction_id.clone()))
            .collect();
        pairs.sort();
        assert_eq!(
            pairs,
            vec![
                (12, "17".to_string()),
                (12, "5".to_string()),
                (13, "17".to_string()),
            ]
        );
    }
}

#[cfg(test)]
mod region_sighting_tests {
    use super::*;
    use atlantis_hud_core::backup::{GameBackup, CURRENT_GAME_BACKUP_VERSION, GAME_BACKUP_FORMAT};
    use tempfile::tempdir;

    fn game(dir: &std::path::Path) -> OpenedGame {
        create_game(
            dir,
            &GameManifest {
                manifest_version: 1,
                metadata: GameMetadata {
                    game_id: "faction-95".to_string(),
                    game_name: "Borg TNG".to_string(),
                    ruleset_id: "neworigins".to_string(),
                    active_faction_id: None,
                },
                report_sources: Vec::new(),
                created_at: "2026-08-01T09:00:00Z".to_string(),
                last_opened_at: "2026-08-01T09:00:00Z".to_string(),
            },
        )
        .expect("game should be created")
    }

    fn sighting(region_id: &str, turn: u32) -> RegionSighting {
        RegionSighting {
            region_id: region_id.to_string(),
            x: 7,
            y: 53,
            z: 1,
            terrain: "mountain".to_string(),
            province: "Inhead".to_string(),
            label: format!("mountain (7,53) in Inhead, turn {turn}"),
            last_seen_turn: turn,
            payload_json: "{}".to_string(),
        }
    }

    fn report_region_json(region_id: &str) -> String {
        format!(
            r#"{{
                "regionId":"{region_id}",
                "coordinate":{{"x":7,"y":53,"z":1}},
                "terrain":"mountain",
                "province":"Inhead",
                "settlement":null,
                "population":null,
                "race":null,
                "taxBase":null,
                "wages":null,
                "maxWages":null,
                "entertainment":null,
                "products":[],
                "wanted":[],
                "forSale":[],
                "exits":[],
                "structures":[],
                "units":[]
            }}"#
        )
    }

    #[test]
    fn a_region_records_the_turn_it_was_last_seen_in() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_region_sightings(
            &opened.database_path,
            "faction-95",
            "95",
            &[sighting("1:7,53", 71)],
        )
        .expect("sightings should persist");

        let loaded =
            load_region_sightings(&opened.database_path, "faction-95", "95").expect("load");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].last_seen_turn, 71);
        assert_eq!(loaded[0].terrain, "mountain");
    }

    #[test]
    fn a_newer_sighting_replaces_an_older_one() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_region_sightings(
            &opened.database_path,
            "faction-95",
            "95",
            &[sighting("1:7,53", 70)],
        )
        .expect("first");
        upsert_region_sightings(
            &opened.database_path,
            "faction-95",
            "95",
            &[sighting("1:7,53", 71)],
        )
        .expect("second");

        let loaded =
            load_region_sightings(&opened.database_path, "faction-95", "95").expect("load");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].last_seen_turn, 71);
        assert!(loaded[0].label.ends_with("turn 71"));
    }

    /// Pins that the guard against a hex going backwards is *not* here: it lives in
    /// `import_writes` (the core), so a reader who misses it in SQL does not put it back.
    #[test]
    fn upsert_region_sightings_writes_whatever_turn_it_is_given() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_region_sightings(
            &opened.database_path,
            "faction-95",
            "95",
            &[sighting("1:7,53", 71)],
        )
        .expect("current");
        upsert_region_sightings(
            &opened.database_path,
            "faction-95",
            "95",
            &[sighting("1:7,53", 60)],
        )
        .expect("older");

        let loaded =
            load_region_sightings(&opened.database_path, "faction-95", "95").expect("load");
        assert_eq!(
            loaded[0].last_seen_turn, 60,
            "the store keeps whatever it was told last"
        );
    }

    #[test]
    fn regions_from_different_turns_coexist_so_staleness_is_computable() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_region_sightings(
            &opened.database_path,
            "faction-95",
            "95",
            &[sighting("1:7,53", 71), sighting("1:26,52", 64)],
        )
        .expect("sightings");

        let loaded =
            load_region_sightings(&opened.database_path, "faction-95", "95").expect("load");
        assert_eq!(loaded.len(), 2);
        // Most recently seen first, which is the order the map wants for drawing.
        assert_eq!(loaded[0].last_seen_turn, 71);
        assert_eq!(loaded[1].last_seen_turn, 64);
    }

    #[test]
    fn a_game_backup_round_trips_turns_drafts_and_remembered_map() {
        let dir = tempdir().expect("tempdir");
        let opened = create_game(
            dir.path(),
            &GameManifest {
                manifest_version: 1,
                metadata: GameMetadata {
                    game_id: "alpha".to_string(),
                    game_name: "Alpha".to_string(),
                    ruleset_id: "neworigins".to_string(),
                    active_faction_id: None,
                },
                report_sources: Vec::new(),
                created_at: "2026-08-01T09:00:00Z".to_string(),
                last_opened_at: "2026-08-01T09:00:00Z".to_string(),
            },
        )
        .expect("alpha");

        let turn = ImportedTurnRecord {
            key: ImportedTurnKey {
                game_id: "alpha".to_string(),
                faction_id: "17".to_string(),
                turn_number: 12,
            },
            raw_report: "TURN: 12".to_string(),
            parsed_payload_json: r#"{"turnHeader":{"turnNumber":12,"season":"Spring"}}"#
                .to_string(),
            warnings_payload_json: "[]".to_string(),
        };
        upsert_imported_turn(
            &opened.database_path,
            &turn,
            "2026-08-01T10:00:00Z",
            "2026-08-01T10:00:00Z",
        )
        .expect("turn should save");
        upsert_order_draft(
            &opened.database_path,
            &OrderDraftRecord {
                key: OrderDraftKey {
                    game_id: "alpha".to_string(),
                    faction_id: "17".to_string(),
                    turn_number: 12,
                },
                order_text: "@work".to_string(),
                updated_at: "2026-08-08T00:00:00Z".to_string(),
            },
        )
        .expect("draft should save");
        upsert_region_sightings(
            &opened.database_path,
            "alpha",
            "17",
            &[RegionSighting {
                region_id: "1:7,53".to_string(),
                x: 7,
                y: 53,
                z: 1,
                terrain: "mountain".to_string(),
                province: "Inhead".to_string(),
                label: "mountain (7,53) in Inhead".to_string(),
                last_seen_turn: 12,
                payload_json: report_region_json("1:7,53"),
            }],
        )
        .expect("sighting should save");
        upsert_hex_note(
            &opened.database_path,
            &HexNote {
                id: "note-1".to_string(),
                game_id: "alpha".to_string(),
                region_id: "1:7,53".to_string(),
                text: "Mustn't forget the mountain pass".to_string(),
                on_map: true,
                turn: 12,
                created_at: "2026-08-08T00:00:00Z".to_string(),
                updated_at: "2026-08-08T00:00:00Z".to_string(),
            },
        )
        .expect("note should save");

        let mut backup = serde_json::from_str::<serde_json::Value>(
            &export_game(dir.path(), "alpha", "2026-08-09T19:00:00Z")
                .expect("backup should export"),
        )
        .expect("backup should parse");
        assert_eq!(backup["exportedAt"], "2026-08-09T19:00:00Z");
        backup["manifest"]["metadata"]["gameId"] = serde_json::Value::String("beta".to_string());
        let restored = import_game(
            dir.path(),
            &serde_json::to_string(&backup).expect("backup should serialize"),
            "2026-08-09T18:30:00Z",
        )
        .expect("backup should import");

        assert_eq!(restored.manifest.metadata.game_id, "beta");
        assert_eq!(restored.manifest.last_opened_at, "2026-08-09T18:30:00Z");
        assert!(load_imported_turn(
            &restored.database_path,
            &ImportedTurnKey {
                game_id: "beta".to_string(),
                faction_id: "17".to_string(),
                turn_number: 12,
            }
        )
        .expect("load turn")
        .is_some());
        assert_eq!(
            load_order_draft(
                &restored.database_path,
                &OrderDraftKey {
                    game_id: "beta".to_string(),
                    faction_id: "17".to_string(),
                    turn_number: 12,
                }
            )
            .expect("load draft")
            .expect("draft should exist")
            .order_text,
            "@work"
        );
        assert_eq!(
            load_region_sightings(&restored.database_path, "beta", "17")
                .expect("load remembered map")
                .len(),
            1
        );
        let restored_notes =
            list_hex_notes(&restored.database_path, "beta").expect("load hex notes");
        assert_eq!(restored_notes.len(), 1);
        assert_eq!(restored_notes[0].id, "note-1");
        assert_eq!(restored_notes[0].game_id, "beta");
        assert_eq!(restored_notes[0].text, "Mustn't forget the mountain pass");
    }

    #[test]
    fn a_restored_sighting_carries_the_same_label_an_imported_one_does() {
        let dir = tempdir().expect("tempdir");
        let opened = create_game(
            dir.path(),
            &GameManifest {
                manifest_version: 1,
                metadata: GameMetadata {
                    game_id: "gamma".to_string(),
                    game_name: "Gamma".to_string(),
                    ruleset_id: "neworigins".to_string(),
                    active_faction_id: None,
                },
                report_sources: Vec::new(),
                created_at: "2026-08-01T09:00:00Z".to_string(),
                last_opened_at: "2026-08-01T09:00:00Z".to_string(),
            },
        )
        .expect("gamma");
        upsert_region_sightings(
            &opened.database_path,
            "gamma",
            "17",
            &[RegionSighting {
                region_id: "1:7,53".to_string(),
                x: 7,
                y: 53,
                z: 1,
                terrain: "mountain".to_string(),
                province: "Inhead".to_string(),
                label: "mountain (7,53) in Inhead".to_string(),
                last_seen_turn: 12,
                payload_json: report_region_json("1:7,53"),
            }],
        )
        .expect("sighting should save");

        let mut backup = serde_json::from_str::<serde_json::Value>(
            &export_game(dir.path(), "gamma", "2026-08-09T19:00:00Z")
                .expect("backup should export"),
        )
        .expect("backup should parse");
        backup["manifest"]["metadata"]["gameId"] = serde_json::Value::String("delta".to_string());
        let restored = import_game(
            dir.path(),
            &serde_json::to_string(&backup).expect("backup should serialize"),
            "2026-08-09T18:30:00Z",
        )
        .expect("backup should import");

        let loaded = load_region_sightings(&restored.database_path, "delta", "17")
            .expect("load remembered map");
        assert_eq!(loaded[0].label, "mountain (7,53) in Inhead");
    }

    #[test]
    fn hex_note_backup_field_is_optional_on_import() {
        let dir = tempdir().expect("tempdir");
        let manifest = GameManifest {
            manifest_version: 1,
            metadata: GameMetadata {
                game_id: "pre-hex-notes".to_string(),
                game_name: "Pre Hex Notes".to_string(),
                ruleset_id: "neworigins".to_string(),
                active_faction_id: None,
            },
            report_sources: Vec::new(),
            created_at: "2026-08-01T09:00:00Z".to_string(),
            last_opened_at: "2026-08-01T09:00:00Z".to_string(),
        };
        let mut backup_json = serde_json::to_value(GameBackup {
            format: GAME_BACKUP_FORMAT.to_string(),
            version: CURRENT_GAME_BACKUP_VERSION,
            exported_at: "2026-08-01T09:00:00Z".to_string(),
            manifest,
            imported_turns: Vec::new(),
            order_drafts: Vec::new(),
            region_sightings: Vec::new(),
            merged_reports: Vec::new(),
            hex_notes: Vec::new(),
        })
        .expect("serialize backup");
        backup_json
            .as_object_mut()
            .expect("backup is an object")
            .remove("hexNotes");

        let restored = import_game(dir.path(), &backup_json.to_string(), "2026-08-01T09:00:00Z")
            .expect("a backup written before hex notes existed should still import");

        assert_eq!(
            list_hex_notes(&restored.database_path, "pre-hex-notes")
                .expect("list should succeed")
                .len(),
            0
        );
    }

    #[test]
    fn a_future_game_backup_is_refused_with_a_reason() {
        let backup = serde_json::to_string(&GameBackup {
            format: GAME_BACKUP_FORMAT.to_string(),
            version: 99,
            exported_at: "2026-08-01T09:00:00Z".to_string(),
            manifest: GameManifest {
                manifest_version: 1,
                metadata: GameMetadata {
                    game_id: "future".to_string(),
                    game_name: "Future".to_string(),
                    ruleset_id: "neworigins".to_string(),
                    active_faction_id: None,
                },
                report_sources: Vec::new(),
                created_at: "2026-08-01T09:00:00Z".to_string(),
                last_opened_at: "2026-08-01T09:00:00Z".to_string(),
            },
            imported_turns: Vec::new(),
            order_drafts: Vec::new(),
            region_sightings: Vec::new(),
            merged_reports: Vec::new(),
            hex_notes: Vec::new(),
        })
        .expect("serialize backup");

        let error = import_game(
            tempdir().expect("tempdir").path(),
            &backup,
            "2026-08-01T09:00:00Z",
        )
        .expect_err("future backup should be refused");
        assert!(error.to_string().contains("newer than this build supports"));
    }
}

#[cfg(test)]
mod merged_report_tests {
    use super::*;
    use tempfile::tempdir;

    const GAME: &str = "faction-95";

    fn game(dir: &std::path::Path) -> OpenedGame {
        create_game(
            dir,
            &GameManifest {
                manifest_version: 1,
                metadata: GameMetadata {
                    game_id: GAME.to_string(),
                    game_name: "Borg TNG".to_string(),
                    ruleset_id: "neworigins".to_string(),
                    active_faction_id: None,
                },
                report_sources: Vec::new(),
                created_at: "2026-08-01T09:00:00Z".to_string(),
                last_opened_at: "2026-08-01T09:00:00Z".to_string(),
            },
        )
        .expect("game should be created")
    }

    fn merge_of(merged_faction_id: &str, turn_number: u32, merged_at: &str) -> MergedReportRecord {
        MergedReportRecord {
            game_id: GAME.to_string(),
            faction_id: "95".to_string(),
            turn_number,
            merged_faction_id: merged_faction_id.to_string(),
            merged_faction_name: format!("Ally {merged_faction_id}"),
            merged_at: merged_at.to_string(),
        }
    }

    #[test]
    fn an_allied_report_is_recorded_against_the_map_it_grew() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_merged_report(
            &opened.database_path,
            &merge_of("73", 71, "2026-08-10T10:00:00Z"),
        )
        .expect("the merge should be recorded");

        let loaded = load_merged_reports(&opened.database_path, GAME, "95", 71)
            .expect("load should succeed");
        assert_eq!(loaded, vec![merge_of("73", 71, "2026-08-10T10:00:00Z")]);
    }

    #[test]
    fn merging_the_same_ally_again_restamps_rather_than_duplicating() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_merged_report(
            &opened.database_path,
            &merge_of("73", 71, "2026-08-10T10:00:00Z"),
        )
        .expect("first merge");
        upsert_merged_report(
            &opened.database_path,
            &merge_of("73", 71, "2026-08-10T18:30:00Z"),
        )
        .expect("second merge");

        let loaded = load_merged_reports(&opened.database_path, GAME, "95", 71).expect("load");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].merged_at, "2026-08-10T18:30:00Z");
    }

    #[test]
    fn several_allies_read_back_in_the_order_they_were_merged() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_merged_report(
            &opened.database_path,
            &merge_of("81", 71, "2026-08-10T11:00:00Z"),
        )
        .expect("second ally, merged first");
        upsert_merged_report(
            &opened.database_path,
            &merge_of("73", 71, "2026-08-10T10:00:00Z"),
        )
        .expect("first ally");

        let ids: Vec<String> = load_merged_reports(&opened.database_path, GAME, "95", 71)
            .expect("load")
            .into_iter()
            .map(|record| record.merged_faction_id)
            .collect();
        assert_eq!(ids, vec!["73".to_string(), "81".to_string()]);
    }

    /// A merge belongs to the turn it was made in, so next turn's map starts from nobody.
    #[test]
    fn a_turn_that_has_had_nothing_merged_into_it_reads_empty() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_merged_report(
            &opened.database_path,
            &merge_of("73", 71, "2026-08-10T10:00:00Z"),
        )
        .expect("turn 71");

        assert!(load_merged_reports(&opened.database_path, GAME, "95", 72)
            .expect("load")
            .is_empty());
    }

    /// The row says whose map grew, not only whose report grew it: two factions in one game keep
    /// separate maps, and merging into one must not claim to have merged into the other.
    #[test]
    fn one_factions_merges_are_invisible_to_another() {
        let dir = tempdir().expect("tempdir");
        let opened = game(dir.path());

        upsert_merged_report(
            &opened.database_path,
            &merge_of("73", 71, "2026-08-10T10:00:00Z"),
        )
        .expect("merged into 95's map");

        assert!(load_merged_reports(&opened.database_path, GAME, "73", 71)
            .expect("load")
            .is_empty());
    }
}
