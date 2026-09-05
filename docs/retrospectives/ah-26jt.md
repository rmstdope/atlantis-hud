# ah-26jt — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-05
- **PR:** #978

## The plan's own RED test passed against the unchanged code

**What happened.** Increment 2's named failing test was specified in the plan down to its data:
`[unit("30", false), unit("7", true), unit("19", false)]`, expecting `["7", "19", "30"]` from
`sortUnits(units, DEFAULT_SORT)`. Written exactly as specified and run before any production change
(`pnpm exec vitest run --root packages/shared src/unitTable.test.ts`), it **passed**. The old default
sorted by `name`, the test helper sets `name: unitId`, and `"19"` precedes `"30"` as a string as well
as a number — so the id-ordered expectation held by coincidence. Only increments 3's two cases were
genuinely red. Replacing `19` with `9` (which follows `30` by name and precedes it by number) made it
fail as intended, and it is the version that merged, with a comment beside it saying why.

**Why.** A plan that writes the failing test's data out in full is picking values against the
*intended* order without checking them against the *current* one. Where the two orders happen to
agree on the sample chosen — easy with two-digit ids, where string and numeric order coincide unless
the digit counts differ — the test is vacuous and nothing downstream catches it: it is green before
the change and green after, so the gate, CI and the review all pass it.

**Cost.** About five minutes: one extra vitest run to notice the test was green when it should not
have been, and one edit. Small here only because the run order (write test, run it, expect red) made
it visible immediately. An implementer that wrote the test and the production change together, or
that trusted a plan-specified test to be red without running it, would have merged a test asserting
nothing.

**Prevent by.** Two places, either of which would have caught it.
1. `plan-bead`'s increments: where a plan specifies a failing test's data literally, it should state
   what the test returns *today* as well as what it must return after the change, so a value pair
   that cannot distinguish the two is visible while the plan is being written.
2. `implement-bead`'s *Building* section already says each increment "opens with its named failing
   test" — worth making explicit that a plan-specified test which does not actually go red is a
   defect in the test data, to be strengthened and the deviation recorded, not a signal that the
   increment is already done.

**Seen before.** None found. Grepped `docs/retrospectives/` for "already passed", "passes before",
"coincidence", "did not fail", "not actually red" and "vacuous"; the matches (`ah-k6i.5`, `ah-s0m`,
`ah-t2pn.4`, `ah-qled.4`, `ah-ycuj`) are all about CI, disk or rebases, not about a test that was
never red.
