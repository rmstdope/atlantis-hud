# Issue #4 Persistence Contracts

## Scope

This document defines the baseline persistence contracts delivered by issue #4.

- SQLite-backed game persistence
- Startup migrations with schema version tracking
- JSON game manifest for portable workspace metadata

> Issue #4 called a game a *project*. Issue #33 renamed the concept, in the code and in the schema,
> because a game became something the player creates, names and picks between. The sections below
> use the current word except where they quote a migration by version, since a migration is history
> and cannot be reworded after the fact. See `docs/issue-33-game-contracts.md`.

## Migration policy

1. Migrations are versioned SQL files committed to `crates/core-persistence/migrations/`.
2. Migrations run automatically whenever a game database is opened or created.
3. Applied migration versions are stored in `schema_migrations`.
4. Migration failures are blocking errors and must be surfaced to the caller.
5. New migrations must be additive and preserve upgradeability from prior versions.

## Schema v1

`0001_initial.sql` creates:

- `schema_migrations(version, applied_at)`
- `project_metadata(project_id, project_name, manifest_version)` — renamed to
  `game_metadata(game_id, game_name, manifest_version, ruleset_id)` by `0005_rename_project_to_game.sql`
- `report_sources(source_id, label)`

## Game manifest contract

Game manifests use a human-readable JSON format with:

- `manifestVersion`
- `metadata.gameId`
- `metadata.gameName`
- `reportSources[]` containing logical `sourceId` and `label`

Compatibility rules:

- Readers must accept manifests with `manifestVersion <= current`.
- Writers emit the current version.
- Unknown future versions are rejected with explicit errors.

## Storage layout

- Desktop: sidecar SQLite file next to the game manifest (`<manifest-stem>.sqlite`)
- Web fallback in app shell: in-memory persistence contract for unsupported environments
