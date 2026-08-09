# Game contracts (issue #33)

All user data belongs to a **game**. The player creates games, names them, chooses which ruleset
each is played under, switches between them and deletes them. Each game owns its own database, so
nothing one game stores can be read by another.

A game is what issue #4 called a *project*. The word was renamed everywhere — Rust, TypeScript and
the SQLite schema — rather than kept as a second name for the same thing.

## Where a game lives

**Desktop.** Under the platform application data directory, resolved by the Tauri shell from the
bundle identifier `com.atlantis.hud`. The frontend never sees or composes a path.

```
<app-data>/games/<game-id>/game.json      the manifest
<app-data>/games/<game-id>/game.sqlite    the sidecar database
```

**Web.** One IndexedDB database per game, plus a registry holding only the manifests.

```
atlantis-hud (v4)
  games                 one manifest per game, keyed by gameId

atlantis-hud-game-<id> (v1)
  importedTurns         keyed [factionId, turnNumber]
  orderDrafts           keyed [factionId, turnNumber]
  regionSightings       keyed [factionId, regionId]
```

The `databasePath` that every storage call already carried is a real path on the desktop and an
opaque `idb://game-<id>` handle in the browser. Callers do not need to know which.

Isolation by key prefix inside one database would have been less code. A database per game makes
deletion one call that cannot miss rows, where a prefix sweep across three stores can.

## Manifest

```json
{
  "manifestVersion": 1,
  "metadata": { "gameId": "…", "gameName": "…", "rulesetId": "neworigins" },
  "reportSources": [],
  "createdAt": "2026-08-01T09:00:00Z",
  "lastOpenedAt": "2026-08-09T18:30:00Z"
}
```

- `gameId` is minted by the shell with `crypto.randomUUID()`. It is never shown; it only has to be
  unique.
- `gameName` is the player's, trimmed. Duplicates are allowed — the id distinguishes them.
- Timestamps are supplied by the caller rather than read from a clock in Rust, so both platforms
  agree on the format and the persistence layer needs no notion of time. This follows the precedent
  set by `OrderDraftRecord.updated_at`.

## Listing, and which game reopens

There is no index. `list_games` reads each game's own manifest, so a listing cannot disagree with
what is on disk. A game whose manifest is missing or unreadable is **skipped**, not fatal: one
broken game must not hide the others from a player who then cannot reach any of them.

The game with the newest `lastOpenedAt` reopens on the next launch. `open_game` rewrites that stamp,
which is why it lives on each game rather than in a shared preference — there is no second copy to
fall out of step, and the browser and the desktop answer the question the same way.

## Ruleset

A game records **which** ruleset it is played under, never a copy of it. Movement costs are scraped
per server (`docs/ruleset-contract.md`), so freezing a scrape into every game would turn correcting
a movement value into a data migration.

`packages/shared/src/rulesets.ts` maps an id to the file the shell fetches:

| id | label | served from |
| --- | --- | --- |
| `neworigins` | NewOrigins | `/ruleset.json` |

Adding a ruleset is a scrape and one entry here. A game naming a ruleset this build does not ship
**fails loudly** rather than falling back, for the reason the ruleset contract already gives: a
movement number that is quietly wrong produces routes that are confidently wrong.

## Games and factions

A game holds as many factions as its reports name. Every table is keyed `(game_id, faction_id, …)`
already, so this needs no constraint — and it matches a player running several factions on one
server. The report decides which faction a turn is filed under; the open game decides which database
it is filed in.

## Schema

`0005_rename_project_to_game.sql` renames `project_metadata` to `game_metadata` and `project_id` to
`game_id` across every table, and adds `game_metadata.ruleset_id`. `CURRENT_SCHEMA_VERSION` is 5.

SQLite's `ALTER TABLE … RENAME COLUMN` carries composite primary keys and indexes with it, so no row
is copied; only index *names* had to be recreated, since those do not follow their columns.

## Deleting

Deleting removes the game's whole directory (desktop) or its database and manifest row (web). Its
turns, orders and remembered map live nowhere else, so nothing survives to leak into a later game.
The picker asks first, inline, naming the game and what is lost — there is no undo anywhere in this
application.

Deleting the open game moves the player to the next most recently opened one, or to the create
screen when it was the last.

## With no game

The workspace is not rendered. The only thing on offer is creating a game — there is nowhere for a
report, an order or a remembered map to go until one exists, and a screen of disabled controls would
only invite the player to hunt for the way in.

## Out of scope

- Order-draft autosave and save-on-quit — issue #34.
- Renaming, exporting or importing a game.
- Letting a player point a game at their own server's rules and data pages.
