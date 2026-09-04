# ah-5wbc — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-05
- **PR:** #958

## Adding a column broke three smoke specs that count header cells, and the plan checked the wrong kind of selector

**What happened.** The plan's *Known traps* checked the smoke suite for **positional** selectors
(`td:nth-child(n)`) and correctly concluded that a column inserted at position 7 left every one of
them alone. It did not check for **fixed column counts**, and there are three:
`tests/smoke/armies.spec.ts:100` (`toHaveCount(14)`), `armies.spec.ts:126` (`11`) and
`tests/smoke/foreignUnits.spec.ts:62` (`12`). All four smoke shards went red on them, on a change
whose whole point is a twelfth column.

**Why.** Established. `awk '/td:nth-child/' tests/smoke/*.spec.ts` is a different search from
`awk '/thead th"\)\)\.toHaveCount/' tests/smoke/*.spec.ts`, and only the first was run — by the plan
and then by me, because the plan had named it.

**Cost.** One CI cycle, about 12 minutes, plus a review round on the fix.

**Prevent by.** A plan that adds or removes a column in the units pane should name **both** searches
in its *Known traps*, and the second is
`awk '/thead th/ || /toHaveCount\([0-9]+\)/ {print FILENAME":"FNR}' tests/smoke/*.spec.ts`. The
count assertions are the ones a new column always breaks; the positional ones only sometimes.

**Seen before.** None found for the counts themselves.

## A smoke assertion on a foreign unit's row found no DOM node, and I explained it wrongly

**What happened.** The plan's increment 5 asked for an assertion over `unit-row-16767`, a foreign
unit in the hex under test. It failed with `element(s) not found` on a second CI cycle. My first
explanation, written into the test as a comment, was that "only our own units are drawn for a hex
until a foreign one is pinned" — a product rule that does not exist. The review sub-agent checked it
against `unitsForHex`, `sortUnitsForDisplay` and `pinnedRows` and showed it false: the hex source
draws every unit, and pinning applies only to the `foreign` source. The real cause is that the table
is windowed (`visible.slice(start, end)`) and own units sort first, so a foreign row in a busy hex
has no DOM node until it is scrolled to.

**Why.** Established, and it is the same virtualisation that `ah-1mpx.5` recorded — that
retrospective is about counting rows the DOM does not hold, this one about addressing one. I reached
for a plausible product explanation instead of reading the three functions, and a wrong comment in a
test file is worse than no comment, because the next reader trusts it.

**Cost.** One CI cycle (~12 minutes) for the failing assertion, plus one review round to correct the
comment.

**Prevent by.** Two things. In a plan: a smoke assertion naming a **specific** unit row in the units
pane must name an **own** unit, because own units sort first and the table is windowed — a foreign
row in a hex with several is not reliably rendered. And for an implementer: an explanation written
into a comment is a claim about the codebase, and gets read from the source before it is committed,
exactly like a claim in a PR body.

**Seen before.** `ah-1mpx.5` — the same windowing, the other way round (counting rows rather than
addressing one).
