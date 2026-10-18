# ah-qffa — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-18
- **PR:** #1765

## A smoke test that only ever passed by beating the debounced validation turned main red

**What happened.** CI on #1765 failed in `smoke (web, 2, 2)` at "the silver column forecasts our
own units and sorts on the figure". The PR touches only `semantics.rs`. Main had failed the same
test on 4ff0bd38 and 9d7a3126 (web and desktop-shell), and #1763 and #1764 were stuck behind it
too. Run locally with `--repeat-each 6 --retries 0` it failed 3 times in 6, with the cell reading
`unit 18642 ⚠warning0`. With a 3 s wait before reading, the cell was warned in 6 runs out of 6.

**Why.** ah-rjz2 (3131ab09) made a refused order mark the Silver cell with a ⚠ button
(`rowMonth`'s `warned` includes `silver.refused`). In this fixture 18642's STUDY is refused because
the hex's pool holds nothing. Once the debounced validation lands, the cell's text is no longer a
bare figure. The test's poll and its one-shot sort read passed only when they ran before
validation. ah-rjz2's own CI happened to win that race, and so did f0feaddb's. ah-hgyl's layout
change made losing it more common, so the merge looked like the cause. A revert of ah-vweq
(c99f64f4) changed nothing.

**Cost.** One red CI cycle on this PR, about forty minutes ruling out a core nondeterminism with
native loops of `review_turn` and `validate_orders_request`, and main red for every PR for about
an hour and a half.

**Prevent by.** In `tests/smoke/`, a read of anything the checks decide (a ⚠, a figure, a
refused order) waits first for a marker that only appears once validation has landed, and a
one-shot `evaluateAll` read never follows `fillOrders` directly. A bead that changes what a Silver
cell renders (as ah-rjz2 did) should run the smoke specs that read that cell with
`--repeat-each 5 --retries 0` before it merges, since one green run proves nothing about a race.

**Seen before.** ah-f9q9 and ah-dlao (assertions on state that lands only after the debounced
validation runs).
