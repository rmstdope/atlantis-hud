# ah-1wcw.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #567

## `resting on a unit row summarises it` fails deterministically on this machine, on main as well

**What happened.** CI's `smoke (desktop-shell, 2, 2)` job failed on
`tests/smoke/workspace.spec.ts:1240` — `getByTestId('unit-tooltip')` never appears — while both
`web` shards passed the same spec. Reproduced locally, twice, with
`pnpm exec tsx scripts/withGateLock.ts pnpm exec playwright test --project=desktop-shell -g "resting on a unit row summarises it"`.
Reverting `packages/shared/src/unitTooltip.ts` to main's version did not fix it, so I checked out
`origin/main` over the whole worktree, rebuilt the wasm, and ran the same spec: **it fails there
too**. The bead's diff is not the cause. A re-run of the CI job passed on the same head.

**Why.** Not established. The spec passes on `desktop-shell` in CI and fails on it here, on both
main and this branch, so something about this machine's Chrome or its pinned viewport stops the
hover producing the tooltip. The trace holds no page error — the element is simply never in the
DOM, which rules out a render throw. I did not narrow it further: it is not this bead's code and
the bead's own scope had nothing to do with it.

**Cost.** About 45 minutes and two CI cycles: one red run, three local `desktop-shell` smoke runs
(≈5 minutes each, plus a full `vite build` per run), and a wasm rebuild to make the main comparison
honest.

**Prevent by.** Two things, neither of which an implementer can do:

1. The spec is **flaky in CI and red locally**, which is the worst combination — it wastes a
   re-run budget for every bead that happens to draw the shard it sits in, and it teaches
   implementers to reach for "it was a flake" without checking. It wants a bead of its own: either
   the hover is made deterministic, or the spec is marked as the known-fragile one it is.
2. `implement-bead`'s *Red CI* section says to reproduce a suspected flake locally before
   re-running. It does not say **to also run it against `origin/main`**, which is the step that
   actually answers "is this mine?" — and it is cheap next to the alternative of bisecting your own
   diff. Worth adding there: check the failing spec against main before concluding anything about
   your own change.

**Seen before.** None found — `grep -rn "resting on a unit row\|unit-tooltip" docs/retrospectives/`
prints nothing.
