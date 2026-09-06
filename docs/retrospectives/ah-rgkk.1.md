# ah-rgkk.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-06
- **PR:** #1001

## A plan that removes an attribute has to name every assertion on it, not the ones in the file it names

**What happened.** The plan's *Known traps* named three `title=` assertions to move
(`UnitTableDock.test.tsx:239`, `:1365`, `:1388`) and one smoke test to retarget. Removing the nine
`title` attributes actually broke **eleven** smoke tests: nine asserting on `title` directly
(`gh pr diff` shows them at `workspace.spec.ts:4398`, `4445`, `4466`, `4486`, `4506`, `4526`, `4530`,
`4562`, `4593`, `4607`, `4625`, `4639`) and the Silver column's three exact-text assertions, which
went red because the new `sr-only` sentence is real text and `innerText` reads it. Found only by
running the full suite: `pnpm run check:fast` is green throughout, because none of it is in the fast
gate.

**Why.** The plan's grep was scoped to the unit-test file for the assertions and to one named test
for the hover. `grep -rn 'title=' packages/shared/src/workspace/UnitTableDock.tsx` finds the
attributes; nothing in the plan asked where they were *asserted on*, and
`grep -rn 'toHaveAttribute("title"' tests/` would have listed all nine in one line.

**Cost.** Two full `pnpm run test:smoke` cycles at ~10 and ~22 minutes, plus about 25 minutes of
reproducing individual failures — roughly an hour, all of it after the increments were done.

**Prevent by.** `plan-bead`'s *Known traps* section, for any bead that removes or renames a rendered
attribute, `data-*` hook or accessible name: grep the **whole repository** for assertions on it, not
only the file being changed, and list them. Two greps cover it —
`grep -rn '<the attribute>' tests/ packages/*/src --include='*.test.*' --include='*.spec.*'` and the
same for the text the attribute carried. This is the same shape as the existing "an accessible name
is a shared namespace" trap in `implement-bead`, one step earlier: that one warns a new name can
collide, this one warns a removed one is asserted on somewhere nobody looked.

**Seen before.** None found — `grep -rn "existing assertion" docs/retrospectives/` turns up only
`ah-20di.md`, which is about a different thing (an interface change read as a look question).
