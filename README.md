# atlantis-hud

A frontend for Atlantis (PBEM) that can be deployed both as a web and as a desktop application.

## Requirements

- Node.js 20+
- pnpm 9+
- Rust stable, with the `wasm32-unknown-unknown` target and `wasm-pack`
- On macOS/Windows, Tauri CLI for the native desktop runtime

Add the wasm target and build tool once:

    rustup target add wasm32-unknown-unknown
    cargo install wasm-pack

No C toolchain beyond your platform's own is required. The shared core is pure Rust, so the
WebAssembly build needs nothing but rustup on macOS, Linux and Windows alike. The desktop build
compiles SQLite through `rusqlite`, which uses the ordinary system compiler that Tauri already
requires.

## Install

```bash
pnpm install
```

## Run the app

### Web app

```bash
pnpm --filter @atlantis/web dev
```

This starts the web shell on the default Vite port.

### Desktop shell preview

```bash
pnpm --filter @atlantis/desktop dev
```

This starts the desktop shell as a Vite app on port `4174`.

### Native desktop runtime

The native desktop app uses Tauri and requires the Tauri CLI:

```bash
cargo install tauri-cli --version "^2"
cd apps/desktop/src-tauri
cargo tauri dev --features desktop-runtime
```

`cargo tauri dev` reads the local `tauri.conf.json`, which starts the desktop Vite dev server automatically through `beforeDevCommand`.

## Check and test

Run the whole repository:

```bash
pnpm run check
```

Run individual checks when you only changed one area:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:smoke
```

Rust-only checks:

```bash
cargo test --workspace
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
```

## Workspace bootstrap

- Issue #2 foundation introduces:
  - `apps/web` (React + Vite shell)
  - `apps/desktop` (desktop shell placeholder)
  - `packages/shared` (shared TypeScript primitives)
  - `crates/core` (shared Rust core placeholder)

- Issue #3 adds:
  - `crates/core-wasm` (WASM adapter via `wasm-bindgen`)
  - `crates/core-tauri` (desktop command adapter via Tauri)
  - `packages/core-client` (shared TypeScript client abstraction for both adapters)

- Issue #4 adds:
  - `crates/core-persistence` (SQLite persistence layer with schema migrations and game file format)

- Issue #20 adds:
  - the workspace UI in `packages/shared/src/workspace`, shared by both shells: header, map,
    layer toggles, and collapsible region, unit, orders and unit-table panels
  - Tailwind tokens and a Zustand selection store
  - a rewritten PixiJS map with flat-top hex geometry and four knowledge states
- Issue #19 adds:
  - a real NewOrigins report parser in `crates/core/src/report` (line unwrapping, region blocks,
    units with ownership and skills, structures, exits, markets, the preamble, and the orders
    template)
  - the NewOrigins order vocabulary, replacing the two-command placeholder
  - migration 0004, giving regions their own rows with the turn they were last seen in
  - `parseReportFull` on both platform adapters, carrying the full model to the UI
  - real report fixtures under `tests/fixtures/reports`
- Issue #18 adds:
  - `packages/browser-core` (WebAssembly loader, IndexedDB storage, and the browser `CoreAdapter`)
  - a `wasm-pack` build wired into both shells, replacing the hand-written TypeScript
    re-implementations of the parser, validator and store
  - the three core commands that existed but were never registered with Tauri
- Issue #5 adds:
  - Tolerant Atlantis report parser in `crates/core` (TURN/FACTION/REGION/UNIT/ITEM/MESSAGE sections, structured warnings, partial-result contract)
  - Import persistence in `crates/core-persistence` (migration 0002, `imported_turns` table with composite key, duplicate-safe insert)
  - Parse/preview-import/commit-import commands through both Tauri and WASM adapters
  - Extended `packages/core-client` with all report domain types and normalizers
  - `ReportImportPanel` shared React component in `packages/shared` (drag-drop + file picker, faction confirmation, duplicate overwrite confirmation)
  - Import panel integrated in `apps/web` and `apps/desktop`

- Issue #8 adds:
  - `packages/ruleset`, which scrapes a game's own rules and data pages into `config/public/ruleset.json`
    rather than hard-coding movement numbers that differ between games
  - `crates/core/src/movement`: the ruleset and its validation, a map built from everything the
    faction has seen, movement modes read from the report's own capacity figures, a Dijkstra route
    planner that refuses with a named reason, a risk heuristic, and MOVE order reading and writing
  - the item catalogue the report parser had always lacked, so a unit's men can finally be told
    from its equipment
  - a game per faction, so a loaded turn is remembered and the map spans more than one report
  - the planner panel, the arm-one-pick gesture, and the route overlay the movement chip controls

- Issue #33 adds:
  - games as a first-class thing the player creates, names, switches between and deletes, each with
    a database of its own so no data can leak between them (`docs/issue-33-game-contracts.md`)
  - the game indicator in the header, the picker beneath it, and the create screen that is all the
    application offers until a game exists
  - a ruleset chosen per game, recorded by id and fetched from the file that id names
  - games kept in the platform application data directory, resolved by the desktop shell, so no
    storage path is ever composed by the frontend
  - `create_game`/`open_game`/`list_games`/`delete_game` through both adapters, and migration 0005
    renaming the schema's `project` to `game`

- Issue #34 adds:
  - order drafts that are actually written — five seconds after the last keystroke, thirty at the
    outside, on switching games and on quitting (`docs/issue-34-persistence-contracts.md`)
  - reopening a game on the turn it was last worked on, with its map and its orders, instead of an
    empty workspace over a database that held all three
  - `load_latest_imported_turn` through both adapters, ranking a game's turns by the later of when
    each was imported and when its orders were last edited
  - caller-supplied ISO-8601 import timestamps, and migration 0006 rewriting the rows SQLite had
    stamped in its own format
  - a real save indicator in the orders panel, replacing one made out of `new Date()` that wrote
    nothing
  - the desktop shell's first Tauri capability, so a native window close can be held open long
    enough to finish the write

To fetch the ruleset for a game other than the committed one:

```bash
pnpm --filter @atlantis/ruleset scrape -- \
  --rules https://atlantis-pbem.com/rules \
  --data  https://atlantis-pbem.com/data
```

See `docs/ruleset-contract.md` for what is scraped, what is deliberately not modelled, and why
there is no worker.
