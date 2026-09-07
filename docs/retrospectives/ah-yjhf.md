# ah-yjhf — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-07
- **PR:** #1034

## A plan put load-bearing logic in a file it had already declared untestable

**What happened.** The plan's *Files to change* put the new index expression inline in
`AppShell.tsx`, and its *The test plan* said in the same breath that "`AppShell.tsx` gets no test".
The expression carried a factual premise — "the known map is a superset" of the parsed report —
which is false when `memory.knownMap === null`, a case `AppShell.tsx:972` handles explicitly two
hundred lines above. Built as written, every row of such a report would have lost its structure
name, and the filter and sort with it. Nothing in the fast gate could see it: there is no test that
renders the shell. The cold review found it, and the fix was to give the composition a name
(`structuresForUnitDock`) so it could be tested at all.

**Why.** A plan may place logic in a file it has excused from testing, and nothing checks that the
two decisions are compatible. The excuse is reasonable on its own (the shell is wiring); the
placement is reasonable on its own (the data is the shell's); together they put an unverifiable
factual claim into production.

**Cost.** One review round and one extra CI cycle, about 20 minutes.

**Prevent by.** `plan-bead`'s test-plan section asking, of every file the plan excuses from
testing, that the plan place no behaviour there — only wiring — and that anything with a
precondition in it be named as a helper the plan's test plan covers. An implementer's
counterpart already exists in `implement-bead`'s *When the plan is wrong* for cited helpers; this
is the same check one level up, on the plan's own placement.

**Seen before.** None found.
