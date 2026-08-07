# Issue #4 Persistence Contracts

## Scope

This document defines the baseline persistence contracts delivered by issue #4.

- SQLite-backed project persistence
- Startup migrations with schema version tracking
- JSON project manifest for portable workspace metadata

## Migration policy

1. Migrations are versioned SQL files committed to `crates/core-persistence/migrations/`.
2. Migrations run automatically whenever a project database is opened or created.
3. Applied migration versions are stored in `schema_migrations`.
4. Migration failures are blocking errors and must be surfaced to the caller.
5. New migrations must be additive and preserve upgradeability from prior versions.

## Schema v1

`0001_initial.sql` creates:

- `schema_migrations(version, applied_at)`
- `project_metadata(project_id, project_name, manifest_version)`
- `report_sources(source_id, label)`

## Project manifest contract

Project files use a human-readable JSON format with:

- `manifestVersion`
- `metadata.projectId`
- `metadata.projectName`
- `reportSources[]` containing logical `sourceId` and `label`

Compatibility rules:

- Readers must accept manifests with `manifestVersion <= current`.
- Writers emit the current version.
- Unknown future versions are rejected with explicit errors.

## Storage layout

- Desktop: sidecar SQLite file next to project manifest (`<manifest-stem>.sqlite`)
- Web fallback in app shell: in-memory persistence contract for unsupported environments
