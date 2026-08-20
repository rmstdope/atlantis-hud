# ah-gfzu — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-20
- **PR:** #482

## The plan's acceptance criteria contradicted a smoke test the plan never mentioned

**What happened.** The plan named one test that asserted the defect (`unitTable.test.ts`'s
`toBe(224)`) and had me correct it before the fix. It did not name
`tests/smoke/workspace.spec.ts:2683`, which asserted the *same* wrong semantics geometrically —
`expect(landed!.x).toBeCloseTo(lineBox!.x, 0)`. `pnpm run check:fast` does not run the smoke suites,
so this only appeared as two red CI jobs after the PR was open and reviewed.

**Why.** The two acceptance criteria "the line sits on a boundary of the table as drawn" and "the
column lands exactly where the line said it would" cannot both hold on a rightward drag: the table
does not reorder under the pointer, so columns to the right of the dragged one shift left by its
width when the drag commits. The gap on screen (x=324) and the landing pixel (x=224) are different
coordinates. The plan's own analysis established the first; the second survived from `ah-1owr.3`'s
wording, and the smoke test pinned it.

**Cost.** One CI cycle, one question to the navigator, about 25 minutes. The navigator settled it in
favour of the on-screen boundary, which is what they reported.

**Prevent by.** When a plan says an existing test asserts the defect, it should say so for **every**
suite, not only the unit test — `grep -rn <function name> tests/` at planning time would have found
this one. And a plan whose acceptance criteria restate an *earlier* bead's wording should check that
the wording still holds under the change being planned; here criterion 4 was the old behaviour
described as if it were the new one.

**Seen before.** none found.
