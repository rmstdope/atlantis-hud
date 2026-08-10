# Atlantis HUD Implementation Plan (Executable Issues)

## Stack and deployment decisions

- Desktop-first with web parity
- Shared Rust core with platform adapters (WASM and Tauri)
- React + TypeScript SPA frontend
- Tauri desktop shell
- SVG map renderer (PixiJS until #58; a canvas cannot keep text sharp under zoom)
- SQLite on desktop and on web (WASM + OPFS)
- Offline-first, no backend in milestone 1
- PWA early, deployed to atlantis-hud.kurelid.se (one.com) over FTPS from GitHub Actions
- Tailwind + headless UI primitives
- Zustand + TanStack Query
- CodeMirror 6 for orders editor
- CI gates required before merge: Rust tests, Vitest, Playwright smoke, lint, typecheck

## Operating rules for all implementation issues

Each sub-issue is independently executable by following this contract:

1. **Inputs required** are listed per issue under "Dependency handoff".
2. **Scope and out-of-scope** are explicit to avoid bleed.
3. **Acceptance criteria** are observable and testable.
4. **Validation** includes concrete commands and/or manual checks.
5. **Deliverables** define exactly what must be committed.

## Issue tree

- Epic: #1 https://github.com/rmstdope/atlantis-hud/issues/1
- #2 Foundation workspaces and CI gates
- #3 Shared Rust core and platform adapters
- #4 SQLite persistence, migrations, and project file format
- #5 Report parsing and import workflow
- #6 Order editor, validation, and autosave
- #7 Map renderer and cross-device interaction model
- #8 Movement planning and risk visualization
- #9 Productivity UX, diffs, themes, and snippets
- #10 Deployment, PWA, and desktop release pipeline

## Dependency graph

- #2 has no dependencies
- #3 depends on #2
- #4 depends on #2 and #3
- #5 depends on #3 and #4
- #6 depends on #3, #4, and #5
- #7 depends on #5
- #8 depends on #3 and #7
- #9 depends on #6 and #7
- #10 depends on #6, #7, and #9

## Executable issue contracts

### #2 Foundation workspaces and CI gates

- Dependency handoff: none
- Deliverables:
  - pnpm workspace and Rust workspace committed
  - CI workflows enforcing required gates
  - local feature-flag mechanism
  - structured local logging and export command
- Out of scope:
  - domain rules, parsing, map rendering, order editor
- Validation:
  - CI workflow runs on PR and blocks on failures
  - local command to export logs produces a file
  - feature flags can toggle at least one sample feature

### #3 Shared Rust core and platform adapters

- Dependency handoff:
  - workspace layout and CI from #2
- Deliverables:
  - `core` crate with canonical game domain model
  - WASM adapter surface via `wasm-bindgen`
  - Tauri adapter surface via commands
  - shared TS API abstraction over both adapters
- Out of scope:
  - persistence schema, parser UX, map UI
- Validation:
  - core compiles for native and wasm targets
  - one TS call path works against both adapters
  - adapter API is documented

### #4 SQLite persistence, migrations, and project file format

- Dependency handoff:
  - workspace/CI from #2
  - core model contracts from #3
- Deliverables:
  - desktop and web persistence layer
  - migration framework with schema versioning
  - initial schema and migration files
  - project file format for selected report sources and metadata
- Out of scope:
  - parser semantics, editor behaviors, map interactions
- Validation:
  - startup applies migrations on empty and existing DB
  - project file can be created, saved, reopened
  - migration policy documented

### #5 Report parsing and import workflow

- Dependency handoff:
  - core parser interfaces from #3
  - persistence/project file from #4
- Deliverables:
  - tolerant parser returning warnings and partial results
  - drag-and-drop import plus file picker fallback
  - faction auto-detect + confirmation step
  - parsed turn data persisted
- Out of scope:
  - order editing UX, map rendering, movement planning
- Validation:
  - malformed report sections produce warnings, not full failure
  - import works on desktop and target mobile/desktop browsers
  - confirmed faction persists with imported turn

### #6 Order editor, validation, and autosave

- Dependency handoff:
  - core validation interfaces from #3
  - persistence from #4
  - imported data model from #5
- Deliverables:
  - CodeMirror 6 text-first editor
  - syntax highlighting, diagnostics, command autocomplete
  - live validation and manual full-validate action
  - autosave timer + focus-change save
  - export blocking policy (errors block, warnings do not)
- Out of scope:
  - map renderer internals, movement planner heuristics, deployment
- Validation:
  - diagnostics update while typing
  - manual validate gives full-turn result
  - export blocked with errors and allowed with warnings only
  - autosave restores latest draft after reload

### #7 Map renderer and cross-device interaction model

- Dependency handoff:
  - imported region/unit data model from #5
- Deliverables:
  - PixiJS hex map renderer
  - desktop click-select + right inspector
  - handheld tap-select + bottom sheet
  - region-first unit hierarchy panel
- Out of scope:
  - movement legality/risk algorithms, order validation rules
- Validation (test vectors):
  - desktop: click hex A1 -> inspector shows region A1 and units
  - handheld: tap hex A1 -> bottom sheet opens with same data
  - switch region selection updates hierarchy highlight
  - pan/zoom stays responsive during normal interaction

### #8 Movement planning and risk visualization

- Dependency handoff:
  - movement/domain rules from #3
  - rendered/selectable map surfaces from #7
- Deliverables:
  - path preview with legality and movement cost
  - heuristic risk indicators (low/med/high)
  - worker/thread offloading for heavy computations
- Out of scope:
  - full combat simulator, backend sync, release pipeline
- Validation (test vectors):
  - select unit U, choose destination D -> route shown with total cost
  - illegal path -> explicit illegal state and reason
  - risk indicator appears for selected route/region
  - UI remains interactive while computation runs

### #9 Productivity UX, diffs, themes, and snippets

- Dependency handoff:
  - editor workflows from #6
  - map selection/navigation primitives from #7
- Deliverables:
  - command palette
  - core shortcuts (save, search, next/prev unit, validate)
  - turn-to-turn diffs for units/regions/orders
  - light/dark theme support
  - user snippets and key undo/redo actions
- Out of scope:
  - signing/notarization, deployment infra, backend auth
- Validation:
  - shortcuts execute documented actions
  - command palette navigates to unit/region quickly
  - diff view shows adds/removes/changes for chosen turn pair
  - theme switch persists across restart

### #10 Deployment, PWA, and desktop release pipeline

- Dependency handoff:
  - editor/map outputs from #6 and #7. #9 is listed as a dependency in the epic, but nothing here
    needs it: the settings panel this issue introduces is where #9's theme toggle will land, so the
    order between them is a convenience rather than a constraint.
- Deliverables:
  - PWA configuration and installability, with an offline-capable service worker
  - manual web deployment workflow publishing to atlantis-hud.kurelid.se over FTPS
  - tag-triggered macOS release workflow producing a `.dmg` attached to a GitHub Release
  - settings panel showing the app version, with a manual update check
- Out of scope:
  - adding cloud backend/sync, adding new gameplay features
  - Windows bundles, and in-app auto-update
- Validation:
  - `workflow_dispatch` on main builds the app, passes the PWA suite, and publishes the web app
  - PWA install flow works on target browsers, and the app loads with the network cut
  - a `v*` tag produces macOS and Linux artifacts in CI
  - desktop update check opens the releases page without app instability

Two of these diverge from the original wording of the issue, and deliberately.

Deployment is **manual rather than on merge**. The alternative was a push to main publishing
straight to the only environment there is; a dispatch that refuses to run off main, and that builds
and tests before it uploads, costs one button press and removes that.

The macOS artifact is **unsigned**. Signing and notarization need a paid Apple Developer Program
membership, and there is no free path to a notarized build. The workflow is written so that the six
Apple secrets switch it on when they exist and ad-hoc signing is used when they do not, which keeps
the decision reversible without a rewrite. Until then the download carries Gatekeeper's quarantine
flag and needs clearing once.

Hosting is **one.com rather than GitHub Pages**, because this repository is private: Pages from a
private repository needs a paid plan and publishes a site that is public anyway.

## Recommended execution order

1. #2
2. #3 and #4
3. #5
4. #6 and #7
5. #8 and #9
6. #10
