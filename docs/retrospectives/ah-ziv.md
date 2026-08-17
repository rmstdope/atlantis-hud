# ah-ziv — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #397

## The plan's `:root { font-size }` outranked a stylesheet the smoke suite injects, and broke a passing test

**What happened.** The plan specified the new rule verbatim as `:root { font-size: calc(1rem *
var(--ui-scale)) }`. Written that way, `pnpm run test:smoke` failed `the panes grow when the reader's
text size does` (`tests/smoke/workspace.spec.ts:3396`) in both projects — a test that has nothing to
do with the Interface size setting.
**Why.** Established. That test simulates a reader's font-size preference with
`page.addStyleTag({ content: "html { font-size: 20px }" })`. `:root` is a pseudo-class (specificity
0,1,0) and `html` a type selector (0,0,1), so the app's rule beat the injected one regardless of
order and the simulated preference did nothing. Moving the declaration to a plain `html` selector
ties the specificity and lets the later rule win; every assertion then passed.
**Cost.** One full smoke run, about eight minutes, plus the diagnosis. No CI cycle — it was caught
locally because this bead's plan makes `test:smoke` mandatory, which `check:fast` alone would not
have done.
**Prevent by.** When a plan prescribes a CSS rule that is meant to be overridable — a default a
reader, a user stylesheet or a test can beat — it should say so and pick the *lowest* specificity
that selects the element. `:root` and `html` look interchangeable and are not. Worth a line in the
plan's *Known traps* whenever the root element is styled at all.
**Seen before.** None found.

## A fresh worktree still has no wasm build, and it still costs a failed smoke run

**What happened.** The first `pnpm run test:smoke` in the new worktree died in the web server with
`Could not resolve "./wasm/atlantis_core.js" from packages/browser-core/src/coreWasm.ts`.
`pnpm --filter @atlantis-hud/browser-core run build:wasm` (13s) fixed it.
**Why.** Established, and already written up: `src/wasm/` is generated and git-ignored, so
`pnpm install --frozen-lockfile` does not produce it and nothing in the worktree setup does either.
**Cost.** One failed smoke start, a few minutes. Small in itself — it is the recurrence that matters.
**Prevent by.** The same thing ah-o1t.3 asked for: `build:wasm` belongs in whatever prepares a
worktree (`implement-bead`'s *Workspace* block, or `prepare-worktree`), not in each implementer's
memory. Recording it a second time so the count is visible.
**Seen before.** ah-o1t.3 — same error, same cause, same fix.
