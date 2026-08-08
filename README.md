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
  - `crates/core-persistence` (SQLite persistence layer with schema migrations and project file format)

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
