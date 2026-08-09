# Persistent data (issue #34)

Unsaved data for the open game is written — regularly, on switching games, and on the way out — and
put back when that game is opened again.

Issue #33 left this out by name (`docs/issue-33-game-contracts.md`), and there was more missing than
autosave. Two things were broken, with one cause: **the storage layer was finished and nothing
called it.**

- Nothing ever wrote an order draft. The table, the UPSERT, the IndexedDB store, both adapters and
  `CoreClient.saveOrderDraft` had existed since issue #4, with tests, and had no caller in the UI.
  The orders panel showed a "saved" time made out of `new Date()`: true about the clock and false
  about everything else.
- Nothing ever read an imported turn back. `commitReportImport` genuinely stored the report and its
  region sightings, but the workspace only ever showed what the current session had opened. Opening
  a game showed an empty screen over a database holding the turn.

## What is saved, and what is not

| | |
| --- | --- |
| The orders document | Saved. One row per `(game, faction, turn)`, the whole faction document as text. |
| The imported turn and the remembered map | Already saved on import. This issue reads them back. |
| Which panels are folded, which layers are drawn | `localStorage`, since issue #20. Preferences about the workspace, not about a game. |
| The selected hex, unit and level | **Not** saved, as `workspaceStore.ts` already argued: a reload leaves no report loaded, and restoring a hex that no longer exists shows stale headings over empty panels. |
| A planned route | Not saved. It is derived from a unit and a destination, and costs milliseconds to ask for again. |

## When a draft is written

- **Five seconds after the last keystroke.** The timer re-arms on every edit, so a sentence is not
  written a character at a time.
- **Thirty seconds after the document first went dirty, whatever else is happening.** The idle rule
  alone has a hole in it: someone writing steadily for ten minutes never pauses, so nothing is ever
  written — and that is exactly the session worth protecting. The ceiling is not re-armed, so it
  closes the hole without turning the idle rule into a ticker.
- **On switching games**, before the workspace lets go of the document.
- **On quitting.** `pagehide` and `visibilitychange` on both platforms, which covers a tab closing,
  a reload, a navigation away and a laptop being shut. Neither can be awaited, so the ceiling above
  is what bounds the loss. `beforeunload` is deliberately unused: it is the least reliable of the
  three, and its one real power is prompting the player to stay, which is a worse answer than
  saving.
- **Again, after a failed write.** A write that could not land leaves the text owed, and waiting for
  the player to type again would make a passing database hiccup cost the rest of the session. The
  panel keeps showing the reason until one lands.
- **Not** on deleting the open game. The database those orders would go to is about to stop
  existing, and the move to the next game would otherwise write into it.

## The writer, and why it is not in the component

`createDraftWriter` in `packages/shared/src/orderDraft.ts` owns what is owed and enforces one write
at a time. It began as refs inside `AppShell` and moved out because every interesting case in it is
a race, and none of them can be tested while they live inside a React component — which is how the
first version shipped with two of them wrong:

- A keystroke landing **during** a write left the newest text owed, but the write announced *saved*
  anyway. Callers schedule autosave off that state, so the announcement cancelled the timers that
  keystroke had just armed and put nothing in their place: the newest work sat unwritten under a
  panel reading "saved" until the next keystroke, game switch or quit. `saved` is now only
  announced when nothing arrived behind the write.
- On the failing path the same keystroke was **overwritten** by the text that had just failed, so
  those characters were gone. The failed text is now only put back if nothing newer is waiting.

Both are pinned by tests that fail against the previous version.

On the desktop the quit is exact rather than best-effort: `apps/desktop/src/quitGuard.ts` refuses
the window close, awaits the write and then destroys the window. It reaches `AppShell` as the
optional `registerBeforeQuit` prop, so `@tauri-apps/api` stays out of `packages/shared` — that
package is what makes the two builds identical rather than merely similar.

This needs the desktop crate's first capability file,
`apps/desktop/src-tauri/capabilities/default.json`. Commands the application defines itself are not
gated by Tauri's ACL, which is why it managed without one; `onCloseRequested` and `destroy` are
core-plugin calls and are refused without it. Note that `build.rs` only runs `tauri_build` under the
Tauri CLI, so neither `cargo check` nor CI validates that file — driving the build script with
`TAURI_CONFIG` set is how it was checked.

## Which turn reopens

`load_latest_imported_turn(database_path, game_id)`, asked of storage rather than kept in the
manifest or in `localStorage`. The same rule issue #33 chose for games: one source of truth, so a
listing cannot disagree with what is on disk.

"Latest" means **most recently touched** — the later of the turn's `updated_at` and its draft's
`updated_at`, a `LEFT JOIN` on SQLite and a match across two stores on IndexedDB. Ranking on the
import alone would send a player who imported a second faction and then spent the evening writing
the first one's orders back to the faction they only glanced at. Ties break on the turn number, so
the answer does not depend on row order.

`null` for a game with no imports. That is a game just created, not a failure, and the workspace
opens empty rather than complaining.

## Timestamps

`commitReportImport` now takes an ISO-8601 `importedAt` from the caller, as `openGame(gameId,
openedAt)` and `saveOrderDraft(…, updatedAt)` already did.

It has to. `imported_turns` stamped itself with SQLite's `CURRENT_TIMESTAMP` — `2026-08-09
18:30:00` — while `order_drafts.updated_at` is `2026-08-09T18:30:00Z`. Comparing them as text is
wrong at character ten, where a space sorts before `T`: *any* draft dated a given day beat *any*
import that day, whatever the clocks said. And IndexedDB has no `CURRENT_TIMESTAMP` to fall back
on; its turn records carried no time at all.

`0006_iso_import_timestamps.sql` rewrites the rows already on disk. `CURRENT_TIMESTAMP` is UTC, so
appending `Z` states what the value already meant rather than guessing. `CURRENT_SCHEMA_VERSION` is
6.

Re-importing moves `updated_at` and leaves `imported_at`: when a turn first arrived does not change
because it arrived again.

A web turn record written before this change has no timestamp. It sorts last rather than being
dropped — one unrankable turn must not turn into a game that reopens on nothing.

## Draft against template

A draft for that `(faction, turn)` wins over the report's own `ordersTemplate`, **including** when
the player opens the same report file again. There is no undo anywhere in this application, and a
stray file-open must not silently erase an evening's work. A new turn's report brings a clean
template with it, which is the way back to one.

The saved time comes back with the draft, so recovered work reads as *saved* rather than *not saved
yet*.

## What the player sees

The orders panel's footer says one of four things, in the same `orders-status` node it always used:
*not saved yet*, *unsaved changes*, *saving…*, *saved 18:31:04*, or *could not save: …*. A failed
write is coloured and left standing. Orders are the player's own typed work, and a write that fails
silently is the one failure that loses it.

Reopening a game marks the shell busy and then puts `restored turn 71` in the import banner, or the
reason it could not. Silence would be the empty workspace this issue is about, only with a cause
nobody can see.

## Ruleset states

`AppShell` now tracks the ruleset as `loading` / `ready` / `unavailable` rather than a nullable
string. Restoring has to know whether waiting would help, and the two were indistinguishable — which
was already a live bug: a report opened while the fetch was in flight was quietly parsed
unclassified, making every unit's man-count an estimate for no reason but timing.

## Out of scope

- Persisting the selected hex, unit or level.
- Renaming, exporting or importing a game.
- Issue #37, which is about the order pane's comment blocks and newline handling.
