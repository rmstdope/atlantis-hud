# ah-yw4p — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-07
- **PR:** #1408

## Two smoke assertions had been passing without ever checking what they named

**What happened.** The fix took six magic-study warnings off the turn-71 fixture, and four smoke
tests went red on desktop-shell, three on web. Two of the failures were not about the count
changing. Both were assertions that had been passing for the wrong reason. In `workspace.spec.ts`,
"a unit told to spend silver it has not got", the checks after `fillOrders(page, "@work")` read
the region panel and the chip before the recount landed. `fillOrders` replaces the draft, so the
GIVE they described was already gone. Run against `main` with a three-second wait, the chip
settled at 10, not the asserted 12. In "the header chip opens the lines that could not be read",
`toContainText("1 to check")` was matching "11 to check": the label adds the turn's problems to the
unreadable line.
**Why.** `toHaveAttribute` and `toContainText` succeed on their first poll when the stale DOM
already matches, so a value that is about to change passes as if it were the settled one.
`toContainText` with a number is a substring match, so "1" also matches 11, 21 and 31.
**Cost.** One red CI cycle, about forty minutes in all: reading logs, running the walk against
`main`'s source to get the real figure, and rewriting three tests.
**Prevent by.** In `tests/smoke/gameSetup.ts`, the doc comment on `fillOrders` should say that a
count or panel asserted straight afterwards may still be showing the previous draft, and that the
assertion must name the value after the change. A count in chip text should be asserted with an
anchored regex, not with `toContainText` on a bare number (for example
`toHaveText(/(^|\D)5 to check/)`), or through the `data-*` attribute that carries it.
**Seen before.** ah-dbw4 (a smoke test comparing two counts it reads separately); ah-coij ("it
passes" mistaken for "it would fail").
