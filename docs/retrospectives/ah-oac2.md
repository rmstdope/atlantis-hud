# ah-oac2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1080

## `pnpm run check:fast` reported `test FAIL` twice and then passed unchanged

**What happened.** With the branch complete, `pnpm run check:fast` ended
`gate: lint PASS typecheck PASS test FAIL generated PASS fmt PASS clippy PASS` on two consecutive
runs. `pnpm run test` and `pnpm run test:tooling` run directly on the same worktree, between and
after those two runs, both passed (`suites: packages PASS tooling PASS cargo PASS`), and a third
`check:fast` with no change to the tree passed all six legs. Two further direct `pnpm run test` runs
also passed. Nothing in the tree changed across any of it.

**Why.** Not established. The gate's `test` leg is `pnpm run test` (`scripts/runGate.ts:32`), so the
same command that failed inside the gate passed outside it minutes either side. Other worktrees on
this machine (`ah-1zca.4`, `ah-cy9j`, `ah-dksm`, `psylocke`) were building at the time, so machine
contention is a candidate; it was not proved.

**Cost.** About fifteen minutes of re-running and bisecting the leg — and it nearly cost more,
because the obvious reading of `test FAIL` is that the branch is broken.

**Prevent by.** `scripts/runGate.ts` should surface *which* suite failed in its one-line summary, or
at least tell the reader where in its own output to look. As it stands a failed `test` leg names only
the leg, and `runSuites.ts`'s own `suites: …` line is buried thousands of lines up in the combined
output, so the first move after a red gate is re-running the leg by hand to find out what broke.
Naming the failing suite in the summary would have made "it passes on its own" visible in one run
rather than three.

**Seen before.** None found — `docs/retrospectives/ah-rgkk.2.1.md` records a `test FAIL` from the
gate, but from a real and reproducible cause.
