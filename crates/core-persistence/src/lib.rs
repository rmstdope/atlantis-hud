//! Persistence contracts for Atlantis HUD project state.

use std::fs;
use std::path::{Path, PathBuf};

use atlantis_hud_core::{diff_imported_turn_fields, ImportedTurnSnapshotRef};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current schema version expected by the persistence layer.
pub const CURRENT_SCHEMA_VERSION: u32 = 3;
const CURRENT_MANIFEST_VERSION: u32 = 1;
const MIGRATION_0001_INITIAL: &str = include_str!("../migrations/0001_initial.sql");
const MIGRATION_0002_IMPORTED_TURNS: &str = include_str!("../migrations/0002_imported_turns.sql");
const MIGRATION_0003_ORDER_DRAFTS: &str = include_str!("../migrations/0003_order_drafts.sql");

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: [Migration; 3] = [
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
];

/// Project metadata stored in project manifest and database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub project_id: String,
    pub project_name: String,
}

/// Logical report source stored in project manifest and database.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSourceRef {
    pub source_id: String,
    pub label: String,
}

/// Project manifest contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub manifest_version: u32,
    pub metadata: ProjectMetadata,
    pub report_sources: Vec<ReportSourceRef>,
}

/// Snapshot returned after project create/open operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedProject {
    pub project_file_path: PathBuf,
    pub database_path: PathBuf,
    pub schema_version: u32,
    pub manifest: ProjectManifest,
}

/// Unique key for one imported turn in a project.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportedTurnKey {
    pub project_id: String,
    pub faction_id: String,
    pub turn_number: u32,
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

/// Unique key for one persisted order draft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderDraftKey {
    pub project_id: String,
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

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("invalid project manifest version: expected <= {max_supported}, got {actual}")]
    UnsupportedManifestVersion { max_supported: u32, actual: u32 },
    #[error("database file does not exist: {0}")]
    DatabaseFileMissing(String),
    #[error("project file already exists: {0}")]
    ProjectFileAlreadyExists(String),
    #[error("database file already exists: {0}")]
    DatabaseAlreadyExists(String),
    #[error(
        "imported turn already exists for project {project_id}, faction {faction_id}, turn {turn_number}"
    )]
    DuplicateImportedTurn {
        project_id: String,
        faction_id: String,
        turn_number: u32,
    },
}

/// Creates a new project file and initializes sidecar SQLite storage.
pub fn create_project(
    project_file_path: &Path,
    manifest: &ProjectManifest,
) -> Result<OpenedProject, PersistenceError> {
    ensure_supported_manifest_version(manifest.manifest_version)?;
    if project_file_path.exists() {
        return Err(PersistenceError::ProjectFileAlreadyExists(
            project_file_path.to_string_lossy().to_string(),
        ));
    }

    let database_path = sidecar_database_path(project_file_path);
    if database_path.exists() {
        return Err(PersistenceError::DatabaseAlreadyExists(
            database_path.to_string_lossy().to_string(),
        ));
    }

    let temp_manifest_path = write_project_manifest_temp(project_file_path, manifest)?;

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

    if let Err(error) = persist_project_snapshot(&mut connection, manifest) {
        cleanup_file_if_exists(&temp_manifest_path);
        cleanup_file_if_exists(&database_path);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temp_manifest_path, project_file_path) {
        cleanup_file_if_exists(&temp_manifest_path);
        cleanup_file_if_exists(&database_path);
        return Err(PersistenceError::Io(error));
    }

    Ok(OpenedProject {
        project_file_path: project_file_path.to_path_buf(),
        database_path,
        schema_version: current_schema_version(&connection)?,
        manifest: manifest.clone(),
    })
}

/// Opens an existing project and upgrades schema if needed.
pub fn open_project(project_file_path: &Path) -> Result<OpenedProject, PersistenceError> {
    let manifest = load_project_manifest(project_file_path)?;
    ensure_supported_manifest_version(manifest.manifest_version)?;

    let database_path = sidecar_database_path(project_file_path);
    let mut connection = open_database(&database_path)?;
    apply_migrations(&mut connection)?;
    persist_project_snapshot(&mut connection, &manifest)?;

    Ok(OpenedProject {
        project_file_path: project_file_path.to_path_buf(),
        database_path,
        schema_version: current_schema_version(&connection)?,
        manifest,
    })
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
pub fn upsert_imported_turn(
    database_path: &Path,
    record: &ImportedTurnRecord,
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
            project_id,
            faction_id,
            turn_number,
            raw_report,
            parsed_payload_json,
            warnings_payload_json,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
         ON CONFLICT(project_id, faction_id, turn_number) DO UPDATE SET
            raw_report = excluded.raw_report,
            parsed_payload_json = excluded.parsed_payload_json,
            warnings_payload_json = excluded.warnings_payload_json,
            updated_at = CURRENT_TIMESTAMP",
        params![
            record.key.project_id.as_str(),
            record.key.faction_id.as_str(),
            record.key.turn_number,
            record.raw_report.as_str(),
            record.parsed_payload_json.as_str(),
            record.warnings_payload_json.as_str(),
        ],
    )?;
    Ok(())
}

/// Inserts one imported turn payload and fails if the key already exists.
pub fn insert_imported_turn(
    database_path: &Path,
    record: &ImportedTurnRecord,
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
            project_id,
            faction_id,
            turn_number,
            raw_report,
            parsed_payload_json,
            warnings_payload_json,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)",
        params![
            record.key.project_id.as_str(),
            record.key.faction_id.as_str(),
            record.key.turn_number,
            record.raw_report.as_str(),
            record.parsed_payload_json.as_str(),
            record.warnings_payload_json.as_str(),
        ],
    );
    match insert_result {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(error, _))
            if matches!(error.code, ErrorCode::ConstraintViolation) =>
        {
            Err(PersistenceError::DuplicateImportedTurn {
                project_id: record.key.project_id.clone(),
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

fn ensure_supported_manifest_version(version: u32) -> Result<(), PersistenceError> {
    if version <= CURRENT_MANIFEST_VERSION {
        return Ok(());
    }

    Err(PersistenceError::UnsupportedManifestVersion {
        max_supported: CURRENT_MANIFEST_VERSION,
        actual: version,
    })
}

fn open_database(database_path: &Path) -> Result<Connection, PersistenceError> {
    if let Some(parent_dir) = database_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    Ok(Connection::open(database_path)?)
}

#[cfg(test)]
fn save_project_manifest(
    project_file_path: &Path,
    manifest: &ProjectManifest,
) -> Result<(), PersistenceError> {
    if let Some(parent_dir) = project_file_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    let serialized = serde_json::to_vec_pretty(manifest)?;
    let temp_path = project_file_path.with_extension("json.tmp");
    fs::write(&temp_path, serialized)?;
    fs::rename(temp_path, project_file_path)?;
    Ok(())
}

fn write_project_manifest_temp(
    project_file_path: &Path,
    manifest: &ProjectManifest,
) -> Result<PathBuf, PersistenceError> {
    if let Some(parent_dir) = project_file_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    let serialized = serde_json::to_vec_pretty(manifest)?;
    let temp_path = project_file_path.with_extension("json.tmp");
    fs::write(&temp_path, serialized)?;
    Ok(temp_path)
}

fn load_project_manifest(project_file_path: &Path) -> Result<ProjectManifest, PersistenceError> {
    let content = fs::read(project_file_path)?;
    Ok(serde_json::from_slice::<ProjectManifest>(&content)?)
}

fn sidecar_database_path(project_file_path: &Path) -> PathBuf {
    let stem = project_file_path.file_stem().map_or_else(
        || "project".to_string(),
        |value| value.to_string_lossy().to_string(),
    );
    project_file_path.with_file_name(format!("{stem}.sqlite"))
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

fn persist_project_snapshot(
    connection: &mut Connection,
    manifest: &ProjectManifest,
) -> Result<(), PersistenceError> {
    let transaction = connection.transaction()?;
    transaction.execute("DELETE FROM project_metadata", [])?;
    transaction.execute("DELETE FROM report_sources", [])?;
    transaction.execute(
        "INSERT INTO project_metadata (project_id, project_name, manifest_version) VALUES (?1, ?2, ?3)",
        params![
            manifest.metadata.project_id.as_str(),
            manifest.metadata.project_name.as_str(),
            manifest.manifest_version
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
            "SELECT project_id, faction_id, turn_number, raw_report, parsed_payload_json, warnings_payload_json
                FROM imported_turns
                WHERE project_id = ?1 AND faction_id = ?2 AND turn_number = ?3",
            params![key.project_id.as_str(), key.faction_id.as_str(), key.turn_number],
            |row| {
                Ok(ImportedTurnRecord {
                    key: ImportedTurnKey {
                        project_id: row.get::<_, String>(0)?,
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
            project_id,
            faction_id,
            turn_number,
            order_text,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(project_id, faction_id, turn_number) DO UPDATE SET
            order_text = excluded.order_text,
            updated_at = excluded.updated_at",
        params![
            record.key.project_id.as_str(),
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
            "SELECT project_id, faction_id, turn_number, order_text, updated_at
                FROM order_drafts
                WHERE project_id = ?1 AND faction_id = ?2 AND turn_number = ?3",
            params![
                key.project_id.as_str(),
                key.faction_id.as_str(),
                key.turn_number
            ],
            |row| {
                Ok(OrderDraftRecord {
                    key: OrderDraftKey {
                        project_id: row.get::<_, String>(0)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use tempfile::tempdir;

    fn fixture_manifest() -> ProjectManifest {
        ProjectManifest {
            manifest_version: 1,
            metadata: ProjectMetadata {
                project_id: "faction-12".to_string(),
                project_name: "Faction 12 - Spring 12".to_string(),
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
        }
    }

    #[test]
    fn create_project_initializes_manifest_and_database() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let manifest = fixture_manifest();

        let created =
            create_project(&project_path, &manifest).expect("project creation should succeed");

        assert_eq!(created.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(project_path.exists());
        assert!(created.database_path.exists());
        assert_eq!(created.manifest, manifest);
    }

    #[test]
    fn open_project_reuses_saved_manifest_and_schema() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let manifest = fixture_manifest();

        let created =
            create_project(&project_path, &manifest).expect("project creation should succeed");
        let reopened = open_project(&project_path).expect("project reopen should succeed");

        assert_eq!(reopened.manifest, created.manifest);
        assert_eq!(reopened.schema_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(
            schema_version(&reopened.database_path).expect("schema read should succeed"),
            CURRENT_SCHEMA_VERSION
        );
    }

    #[test]
    fn open_project_upgrades_existing_database_schema() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("upgrade.atlantis-project.json");
        let manifest = fixture_manifest();
        save_project_manifest(&project_path, &manifest).expect("manifest save should succeed");
        let database_path = sidecar_database_path(&project_path);
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

        let reopened = open_project(&project_path).expect("upgrade should succeed");

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

    #[test]
    fn create_project_fails_when_manifest_already_exists() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        fs::write(&project_path, b"existing project").expect("seed existing project file");

        let error = create_project(&project_path, &fixture_manifest())
            .expect_err("existing file should fail");
        assert!(matches!(
            error,
            PersistenceError::ProjectFileAlreadyExists(_)
        ));
    }

    #[test]
    fn create_project_fails_when_database_already_exists() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let database_path = sidecar_database_path(&project_path);
        fs::write(&database_path, b"existing database").expect("seed existing db file");

        let error = create_project(&project_path, &fixture_manifest())
            .expect_err("existing db should fail");
        assert!(matches!(error, PersistenceError::DatabaseAlreadyExists(_)));
    }

    #[test]
    fn imported_turn_can_be_inserted_and_loaded() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let manifest = fixture_manifest();
        let created =
            create_project(&project_path, &manifest).expect("project creation should succeed");

        let record = ImportedTurnRecord {
            key: ImportedTurnKey {
                project_id: manifest.metadata.project_id.clone(),
                faction_id: "17".to_string(),
                turn_number: 12,
            },
            raw_report: "TURN: 12 Spring".to_string(),
            parsed_payload_json: "{\"turn\":12}".to_string(),
            warnings_payload_json: "[]".to_string(),
        };

        upsert_imported_turn(&created.database_path, &record).expect("import should persist");
        let loaded =
            load_imported_turn(&created.database_path, &record.key).expect("load should succeed");

        assert_eq!(loaded, Some(record));
    }

    #[test]
    fn imported_turn_preview_reports_diff_for_duplicate() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let manifest = fixture_manifest();
        let created =
            create_project(&project_path, &manifest).expect("project creation should succeed");

        let key = ImportedTurnKey {
            project_id: manifest.metadata.project_id.clone(),
            faction_id: "17".to_string(),
            turn_number: 12,
        };
        let original = ImportedTurnRecord {
            key: key.clone(),
            raw_report: "TURN: 12 Spring".to_string(),
            parsed_payload_json: "{\"turn\":12,\"regions\":1}".to_string(),
            warnings_payload_json: "[]".to_string(),
        };
        upsert_imported_turn(&created.database_path, &original).expect("seed import");

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
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let manifest = fixture_manifest();
        let created =
            create_project(&project_path, &manifest).expect("project creation should succeed");

        let record = ImportedTurnRecord {
            key: ImportedTurnKey {
                project_id: manifest.metadata.project_id.clone(),
                faction_id: "17".to_string(),
                turn_number: 12,
            },
            raw_report: "TURN: 12 Spring".to_string(),
            parsed_payload_json: "{\"turn\":12}".to_string(),
            warnings_payload_json: "[]".to_string(),
        };

        insert_imported_turn(&created.database_path, &record).expect("first insert should succeed");
        let duplicate_error = insert_imported_turn(&created.database_path, &record)
            .expect_err("duplicate insert should fail");
        assert!(matches!(
            duplicate_error,
            PersistenceError::DuplicateImportedTurn { .. }
        ));
    }

    #[test]
    fn order_draft_round_trips_through_persistence() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let manifest = fixture_manifest();
        let created =
            create_project(&project_path, &manifest).expect("project creation should succeed");

        let draft = OrderDraftRecord {
            key: OrderDraftKey {
                project_id: manifest.metadata.project_id.clone(),
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
    fn order_draft_schema_version_is_bumped() {
        let dir = tempdir().expect("tempdir");
        let project_path = dir.path().join("campaign.atlantis-project.json");
        let manifest = fixture_manifest();

        let created =
            create_project(&project_path, &manifest).expect("project creation should succeed");

        assert_eq!(created.schema_version, 3);
    }
}
