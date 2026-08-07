CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_metadata (
    project_id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    manifest_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS report_sources (
    source_id TEXT PRIMARY KEY,
    label TEXT NOT NULL
);
