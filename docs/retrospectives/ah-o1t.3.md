# ah-o1t.3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-15
- **PR:** #276

## A fresh worktree has no wasm build, and `test:smoke` fails with an error that reads unrelated

**What happened.** `pnpm run test:smoke` in the freshly created worktree failed at the dev-server
build step with `Could not resolve "./wasm/atlantis_core.js" from
"../../packages/browser-core/src/coreWasm.ts"` - nothing about the bead's own files. The fix was
`pnpm --filter @atlantis/browser-core run build:wasm`, after which the suite ran normally.

**Why.** `packages/browser-core/src/wasm/` (wasm-pack's output) is build output, not tracked in
git, and `pnpm install --frozen-lockfile` - the one setup step this skill's *Workspace* section
names - does not build it; only `build:wasm` does. A worktree that has never run that script has no
`wasm` directory at all, so the very first thing that imports it fails during the smoke suite's own
build.

**Cost.** About five minutes: one failed `test:smoke` run, tracing the error to the missing
directory, then one `wasm-pack build` (under ten seconds once cargo's own dependencies were warm).

**Prevent by.** The skill's *Workspace* section lists `pnpm install --frozen-lockfile` as the one
setup step a fresh worktree needs before the first `pnpm run lint`. It could name
`pnpm --filter @atlantis/browser-core run build:wasm` alongside it as a second one-time step a
worktree needs before its first `test:smoke` or `test:pwa` run - not every bead reaches the browser
suites, so this is worth doing lazily rather than unconditionally, but naming it up front would save
the next implementer the same detour through an error message that points at the wrong file.

**Seen before.** None found (`grep -rl "build:wasm\|wasm-pack\|Could not resolve.*wasm"
docs/retrospectives/` turned up nothing before this file).
