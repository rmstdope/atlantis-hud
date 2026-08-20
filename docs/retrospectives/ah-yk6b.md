# ah-yk6b — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-20
- **PR:** #485

## Arrowing down a long list moved the highlight less than one row per press

**What happened.** The new smoke test pressed ArrowDown 25 times and found the highlight on row 21,
then on row 14 when the presses were spaced out. Two separate causes, both invisible to the vitest
suites because there is no DOM there:

1. `setIndex(paletteKeyReduce({ index: active, … }))` computed the next row from the *rendered*
   index. Held keys outrun React's renders, so several presses in one commit all computed the same
   destination and the moves collapsed into one.
2. `onPointerEnter` fires when a row scrolls **under a stationary mouse**, not only when the mouse
   moves. Scrolling the highlighted row into view therefore moved a different row beneath wherever
   the pointer happened to sit, and hover selection handed the highlight straight back — the
   highlight sliding *backwards* by ten rows every so often.

**Why.** Both are consequences of the list becoming scrollable, and neither exists while it is
capped at twelve rows with no scrolling. The plan anticipated the *inverse* of (2) — do not scroll
in response to hover — and its guard is correct and still in place; the direction it did not
anticipate is hover reacting to a scroll.
**Cost.** About 25 minutes, four Playwright runs, no CI cycles — the smoke test caught both before
the PR opened.
**Prevent by.** When a list that follows the pointer gains a scroll container, bind hover selection
to `onPointerMove` rather than `onPointerEnter`, and apply keyboard moves to the pending index
(`setIndex((current) => …)`) rather than the rendered one. Both are now commented in
`packages/shared/src/workspace/CommandPalette.tsx`. A plan that adds scrolling to an existing
pointer-following list is worth a trap naming these.
**Seen before.** none found.

## Copilot returned an error instead of a review, twice

**What happened.** `gh pr edit 485 --add-reviewer @copilot` produced a `COMMENTED` review whose
whole body was "Copilot encountered an error and was unable to review this pull request." The
navigator authorised one re-request; it produced a second, identical error. The navigator then read
the PR themselves and reported no findings, which is what the bead merged on.
**Why.** Not established — an outage on GitHub's side, not visible from here.
**Cost.** About 25 minutes of waiting and two questions to the navigator.
**Prevent by.** CLAUDE.md's review rules distinguish a review that lands from one that never
arrives, but not from one that arrives *empty*. Either case is "no second pair of eyes", so the
twenty-minute escalation path is the closest fit — but an errored review is detectable
immediately, and the fifteen minutes spent waiting for a second one bought nothing. Worth the
navigator deciding whether an errored review should escalate at once rather than after a wait.
**Seen before.** ah-60m — the same error text, and the second time the fleet has hit it.
