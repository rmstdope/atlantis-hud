# atlantis-hud

A frontend for Atlantis (PBEM) that can be deployed both as a web and as a desktop application.

## Where your games are kept

Atlantis HUD has no server. Nothing you load or type is ever sent anywhere — your games stay on the
machine you are using. That keeps them private, and it means keeping them safe is partly up to you.

**On the desktop app**, each game is an ordinary file in your user folder, alongside your documents
and photos. It stays there until you delete it, and your usual backups will pick it up.

**In the browser**, games are kept in storage that belongs to that browser on that device. This is
convenient — nothing to install, and your game is there when you come back — but it is not as
durable as a file, and it is worth knowing how it can go away.

### How a browser game can be lost

- **Clearing your browser's site data deletes it.** Clearing your *history* on its own normally
  leaves games alone — it is the "cookies and site data" option, or clearing everything, that
  removes them. In that dialog Atlantis HUD's games look like any other site's data.
- **Safari deletes it after seven days if you do not visit.** This is Safari's normal behaviour for
  websites, and a week between turns is perfectly ordinary in a play-by-email game. **If you use
  Safari, install the app** (Share → Add to Home Screen, or Add to Dock) — installed apps are exempt.
- **A browser short of space may clear it out.** The app now asks your browser to hold on to your
  games, which most will agree to, especially once the app is installed. It is a request, not a
  guarantee.
- **Private or Incognito windows forget everything** the moment you close them.
- **Each browser and each device is separate.** A game started in Chrome on your laptop will not be
  in Safari, or on your phone. There is no syncing between them.

### Keeping a copy

Right now the surest safety net is the turn reports themselves: **keep the report files your game
sends you.** If a game is ever lost, loading those reports back in, oldest first, rebuilds it.

Being able to save a whole game to a single file, and load it back or move it to another device, is
planned — see issue #50.

### Two smaller things

Your orders are saved as you type, a few seconds after you stop, so a crash costs at most the last
sentence or so. And **deleting a game cannot be undone** — the app asks first, and says what will be
lost, because there is no way back.

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

The native desktop app uses Tauri. Its CLI is a workspace dev dependency, so `pnpm install` is all the setup there is:

```bash
pnpm --filter @atlantis/desktop exec tauri dev --features desktop-runtime
```

`tauri dev` reads `apps/desktop/src-tauri/tauri.conf.json`, which starts the desktop Vite dev server automatically through `beforeDevCommand`.

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
pnpm run build:web && pnpm run test:pwa
```

`test:pwa` runs against a production build and needs one made first — it is the only suite here that
does. It is also the only place the service worker exists at all, which is why it is separate from
the smoke suite rather than a third project in it.

Rust-only checks:

```bash
cargo test --workspace
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
```

## Ship it

Full detail, and the reasoning, in `docs/issue-10-release-contracts.md`.

### The web application

Published by hand, from the Actions tab: **Deploy web** → Run workflow, on `main`. It refuses to run
on any other branch. The job builds, runs the PWA suite against the build it is about to upload, and
then uploads it over SFTP to `https://atlantis-hud.kurelid.se` and checks the live site is serving
what it just sent.

It needs three secrets and one variable configured on the repository:

| Name | Kind |
| --- | --- |
| `ONECOM_FTP_SERVER` | secret — the SSH/SFTP hostname |
| `ONECOM_FTP_USERNAME` | secret |
| `ONECOM_FTP_PASSWORD` | secret |
| `ONECOM_FTP_SERVER_DIR` | variable — the directory the domain serves |
| `ONECOM_SFTP_PORT` | variable, optional — defaults to 22 |

The `FTP` in those names is a fossil: the pipeline originally used FTPS, which one.com does not
answer (#43). They hold SFTP credentials.

### The desktop application

Tagging is the release. Bump the version in **both** `package.json` and
`apps/desktop/src-tauri/tauri.conf.json`, then:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

That builds an Apple Silicon `.dmg`, attaches it to a GitHub Release, **and then publishes the
website from the same tag**. The first step of the job checks that the tag and the two files agree,
so a half-done bump fails in seconds rather than after the compile.

The website step runs only if the bundle built, so a release is all or nothing. When a macOS build
fails but a web fix is waiting, run **Deploy web** by hand — that is what the manual trigger is for.

To build one locally:

```bash
pnpm --filter @atlantis/desktop exec tauri build --features desktop-runtime
```

**The artifact is not signed by Apple.** That needs a paid Developer Program membership. macOS will
refuse to open the download and say it is damaged; it is not. Clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine "/Applications/Atlantis HUD.app"
```

The release workflow starts signing and notarizing by itself the day the six `APPLE_*` secrets
exist. Nothing else needs changing.

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

- Issue #28 adds:
  - `crates/core/src/cache.rs`, which parses a turn once and keeps it, keyed on the report text the
    caller already passes: the same four thousand lines were being parsed three times per import
    and once more for every route planned
  - `region_sightings` in the core, so both platforms build the remembered-region rows the same way
    and the browser no longer asks for the whole parsed model back just to serialize eleven regions
  - the longest main-thread block on a report load down from 1204-1945ms to 262-429ms, and the
    same measurement taken while a route is planned down from 397-1391ms to about 150ms - the
    second figure mostly because the load it follows got cheaper, so `docs/ruleset-contract.md`
    says which part of the gain came from where

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

- Issue #37 fixes the orders panel, which three faults between them had left unusable:
  - the server's description of each unit — name, weight, capacity, every skill, wrapped over as
    many as eight `;` lines — is dropped when a template becomes a document, so the editor holds
    the player's orders and nothing else. The unit panel already says all of it. A `;` line in a
    saved draft is the player's own note and is left alone
  - a unit's block now ends at the banner announcing the next region, instead of swallowing it.
    Every region's last unit had been showing the next region's heading as part of its orders
  - a new line can be opened at the end of a block. Each keystroke is written into the faction
    document and read straight back, and a block cannot hold a blank line at its end, so pressing
    Enter used to be undone by the answer coming back — leaving the lines already there as the only
    ones that could be edited. The editor now keeps its own draft where the document disagrees with
    it about nothing else, which also stops the caret jumping and lets undo work
  - the error and warning counts belong to the selected unit rather than to the whole faction, and
    each problem is listed with the line it is on, counted from the top of the block on screen. A
    tally of the rest of the document stays alongside, so a mistake in a unit nobody is looking at
    is still visible before export

To fetch the ruleset for a game other than the committed one:

```bash
pnpm --filter @atlantis/ruleset scrape -- \
  --rules https://atlantis-pbem.com/rules \
  --data  https://atlantis-pbem.com/data
```

See `docs/ruleset-contract.md` for what is scraped, what is deliberately not modelled, and why
there is no worker.
