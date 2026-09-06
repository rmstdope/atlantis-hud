# ah-3oy3 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-06
- **PR:** #1005

## A filter change moves the cell out from under a motionless pointer

**What happened.** The plan's increment-1 test rebuilt the rows by narrowing the units filter from
`1864` to `18642` while the pointer rested on a cell, and asserted the popup survived. Against the
finished fix it failed 2 runs in 3
(`SMOKE_PROJECT=web pnpm exec playwright test workspace --project=web -g "outlives the rows being rebuilt" --repeat-each=3`).
Instrumenting `forgetHover` showed one call right after the keypress and no scroll event: the two
filters match 3 rows and 1 row respectively, the table's automatic column widths change with the
content, and the cell under the unmoved pointer became a *different* column — a silent one, which
closes the popup for an honest reason. The rule under test was fine; the rebuild the test chose was
not.
**Why.** Established. A rebuild that changes the row set changes the column widths, so "the pointer
has not moved" does not mean "the pointer is still on the same cell".
**Cost.** About 25 minutes: three smoke runs, two rounds of `console.log` instrumentation in
`UnitTableDock.tsx`, and a rewritten test. The fix itself was unaffected.
**Prevent by.** When a plan needs the units table rebuilt with the pointer held still, it should name
a rebuild that keeps the row *set* identical, not merely the hovered row. Appending a trailing space
to the filter is the one this bead settled on: `unitTable.ts` matches on `needle.trim()`, so the same
rows come back at the same widths while `visible` gets a fresh identity. A plan that narrows or
widens a filter for this purpose is asking for a test that fails on layout rather than on the rule.
**Seen before.** None found.
