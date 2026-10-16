# ah-2pbd — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-16
- **PR:** #1636

## The silver column's sort smoke test went red in CI and green on a bare re-run of the same commit

**What happened.** CI run 38887227410 (web smoke shard 2/2) failed `tests/smoke/workspace.spec.ts`,
"the silver column forecasts our own units and sorts on the figure", on the first attempt and on
Playwright's retry. The figures read `[14, -50]` after an ascending sort. Locally on the same head the
test passed with `--repeat-each=3`, and so did the whole `--project=web --shard=2/2` (242 passed).
`gh run rerun 38887227410 --failed` then went green with no change.

**Why.** Not established. The column's sort key is the silver forecast alone
(`packages/shared/src/unitTable.ts`, `valueOf`), and this PR changed findings, not forecasts. The
re-run tested the same merge commit, so the ah-dhga cause (main moving under the branch) does not
apply here. The test sorts right after `fillOrders(page, "@study obse")` replaces the FORM orders,
and it reads every row's figure once, with no `expect.poll`. A sort that ran before the forecast
recomputed would leave a stale order on screen.

**Cost.** One bare re-run (1 of 2), about 30 minutes of wall-clock across the failed CI run, the local
shard and the re-run.

**Prevent by.** In `tests/smoke/workspace.spec.ts`, "the silver column forecasts our own units and
sorts on the figure": wait for the formed unit's row (`unit-row-new-1`) to disappear after the last
`fillOrders`, and wrap the sorted-figures assertion in `expect.poll`, so the assertion reads the
table only after the forecast has settled.

**Seen before.** ah-dhga (the same test red in CI and green locally, though with a different,
established cause).
