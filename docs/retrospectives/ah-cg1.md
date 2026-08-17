# ah-cg1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #380 (the submodule bump), and rmstdope/cerebro#52 (the work itself)

## A refactoring plan asserted the old and new queries were equivalent, and two of six were not

**What happened.** The plan required all six replaced `bd` queries to return identical ids before and
after, and put "changing what any of the four queries returns" explicitly out of scope. Cerebro's four
matched exactly. Psylocke's two did not: her work-list query excluded only `event` and never `epic`,
so routing it through `scripts/work-beads` (which excludes both) dropped four closed epics —
`ah-1j5`, `ah-46p`, `ah-bai`, `ah-dbb`. Her first-pass label count moved 226 → 156 for the same
reason. The change is right (an epic has no diff, so a verdict on one can only be `not-needed`, and
recording that writes another event bead) and the first-pass query only ever asks "is this zero",
which both readings answer the same way — but it is a behaviour change the plan forbade, decided by
the implementer rather than the planner.

**Why.** The plan enumerated the call sites from a reading of the four texts, and read the two
`--exclude-type` lists as the same list. They differed by one word.

**Cost.** About ten minutes to establish that the four extra ids were epics and to decide it was a
detail rather than a scope change; no CI cycles, no hand-back.

**Prevent by.** When a plan for a de-duplicating refactoring asserts "identical output, before and
after", the plan itself should diff the call sites it is unifying and *name* any that already differ,
rather than leaving the implementer to discover it and decide. Concretely: `plan-bead`'s
*Increments* section for a refactoring should require the before/after comparison to be run **while
planning** when the plan claims equivalence, not only as evidence in the PR body.

**Seen before.** None found.
