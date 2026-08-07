//! Persistence contracts for Atlantis HUD project state.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current schema version expected by the persistence layer.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;
const CURRENT_MANIFEST_VERSION: u32 = 1;
const MIGRATION_0001_INITIAL: &str = include_str!("../migrations/0001_initial.sql");

struct Migration {
    version: u32,
    sql: &'static str,
}

const MIGRATIONS: [Migration; 1] = [Migration {
    version: 1,
    sql: MIGRATION_0001_INITIAL,
}];

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
}
