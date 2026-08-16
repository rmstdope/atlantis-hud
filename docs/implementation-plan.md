# Atlantis HUD Implementation Plan

## Stack and deployment decisions

- Desktop-first with web parity
- Shared Rust core with platform adapters (WASM and Tauri)
- TypeScript types for the report model are generated from the Rust core by ts-rs into
  `packages/core-client/src/generated/` during `cargo test`; `pnpm run check:generated` and CI
  refuse a stale copy. A new field on a Rust report type is a Rust edit plus a `git add`.
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

## Generated bindings

The report model and the parse family - `ParsedReport`, `ReportParseResultWire` (as
`ReportParseResult`), `EngineInfo`, `OrderValidationResult`, and everything reachable from them - are
generated as TypeScript from the Rust types in `crates/core`, rather than mirrored by hand.

They are generated with `#[cfg_attr(test, derive(ts_rs::TS), ts(export))]` on the Rust type, a
dev-only dependency so nothing about it reaches the wasm or desktop build, and a `[env]` table in
`.cargo/config.toml` that points ts-rs at `packages/core-client/src/generated/`. `cargo test -p
atlantis-hud-core` is the generator: it is what runs the `#[test]` functions ts-rs writes for each
`#[ts(export)]` type.

Never edit a file under `packages/core-client/src/generated/` by hand - it is overwritten on the
next `cargo test`. Regenerate with `cargo test -p atlantis-hud-core` after changing a Rust report
type, and commit the result; `pnpm run check:generated` and CI both fail on a stale copy. A renamed
export (`ts(rename = "...")`) always carries `export_to` alongside it, naming the file the rename
should land in - without it the file keeps the type's Rust name and the re-export in `index.ts`
points at nothing. A type reached only through `#[serde(flatten)]` carries no `export` of its own,
or two types claim the same generated file.

## Operating rules for all work packages

Each work package is independently executable by following this contract:

1. **Inputs required** are the bead's dependency edges (`bd dep add`), not prose. `bd ready` only
   offers a bead once they are satisfied.
2. **Scope and out-of-scope** are explicit in the bead description, to avoid bleed.
3. **Acceptance criteria** are observable and testable, and live in the bead's acceptance field
   (`bd create --acceptance`).
4. **Validation** includes concrete commands and/or manual checks, in the bead description.
5. **Deliverables** define exactly what must be committed, in the bead description.

## Tracking

Work packages are tracked in beads, not in this file and not in GitHub issues. The backlog, its
dependency graph and its execution order are all queries:

    bd ready        # work with no open blockers, in priority order
    bd list         # the whole backlog
    bd blocked      # what is waiting, and on what
    bd show <id>    # one work package's full contract

See `.claude/skills/beads-workflow/SKILL.md` for the workflow, and `.beads/issues.jsonl` for a
readable snapshot of the backlog as committed.

## Appendix: delivered milestone-1 contracts (historical)

The contracts below describe milestone 1, delivered as GitHub issues #1–#10 before work packages
moved to beads. They are kept as a record of what was built and as a worked example of the contract
shape required above. They are not a live backlog.

The milestone was structured as epic #1 with children #2 Foundation workspaces and CI gates, #3
Shared Rust core and platform adapters, #4 SQLite persistence and project file format, #5 Report
parsing and import workflow, #6 Order editor, validation and autosave, #7 Map renderer and
cross-device interaction model, #8 Movement planning and risk visualization, #9 Productivity UX,
diffs, themes and snippets, and #10 Deployment, PWA and desktop release pipeline — each depending on
those before it as recorded under "Dependency handoff" in the contracts.

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

Milestone 1 was executed in this order: #2, then #3 and #4 in parallel, then #5, then #6 and #7, then
#8 and #9, then #10. For current work, the equivalent order is computed from the dependency graph by
`bd ready`.
