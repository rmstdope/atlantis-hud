# ah-sdw5 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-08
- **PR:** #1054

## `toBeVisible()` on a map mark failed in CI while the mark was plainly drawn

**What happened.** The new smoke walk asserted
`expect(map.locator('[data-mark="battle"]').first()).toBeVisible()`. Two of the four smoke shards
failed on it; the log showed the locator resolving to **33 elements**, each carrying
`data-battle="own"` and the right class. `MapCanvas` draws wrapped copies of the world either side
of itself, so the fixture's 4 battle hexes become dozens of elements and `.first()` is whichever
copy the fit happens to put first — off screen as often as not. The mark was correct throughout;
only the assertion was wrong. Changing both assertions to `not.toHaveCount(0)` made it green.
**Why.** Established. Visibility of a *particular* copy of a wrapped map mark is a function of zoom
and viewport, neither of which the walk controls, so `.first()` plus `toBeVisible` is a coin toss
that this machine's `check:fast` never flips — the browser suites do not run locally by default.
**Cost.** One CI cycle and one delta review round, about twenty minutes.
**Prevent by.** `implement-bead`'s plan for a smoke assertion over a map mark should ask for a count
(`not.toHaveCount(0)`), never `toBeVisible` on `.first()`, and never an exact count — the wrap copies
make the number viewport-dependent too. Better still, `.cerebro/traps.md` has no entry for this and
this is at least its fourth sighting; a fact there would reach every planner and implementer, which
is where it belongs.
**Seen before.** ah-46p.2 ("An SVG `<line>` is never `toBeVisible()`, however plainly it is drawn",
and "A map-label smoke-test probe was silently invisible at the default zoom") and ah-67h8 ("A
shipped smoke test was passing by accident of layout"). Same suite, same assertion, same map.

## A plan's edit to a branch nothing can reach

**What happened.** The plan required a second CSS class on Emblem & Dots' battle **dot**
(`ed-dot-battle-other`). `EMBLEM_PRIORITY` puts `battle` first and `dotRow` filters out the emblem's
own feature, so a battle is always the medallion and never a dot: the branch, its test and its CSS
rule were all unreachable. The test I wrote for it failed against correct code, which is how it was
caught. I reverted the edit and recorded the deviation in the PR body.
**Why.** Established. The plan reasoned about the two places a battle *appears* in that theme
without following `dotRow`'s filter, which is four lines away from the priority list it did cite.
**Cost.** About ten minutes, including writing the test that disproved it.
**Prevent by.** `implement-bead`'s *When the plan is wrong* already says to read a helper the plan
cites for what it decides before building on it; the same care is owed to a helper the plan cites
only in passing when it is what makes the plan's edit reachable. Writing the test first is what made
this cheap, and is the general answer.
**Seen before.** None found.
