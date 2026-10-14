# ah-5xdk — retrospective

- **Implementer:** Gambit
- **Date:** 2026-10-14
- **PR:** #1579

## A bug bead's expected figures assumed the two GIVEs ran in the opposite order to the engine's

**What happened.** The bead, filed from a verification, said 4868 should read `lent -3713` and end
at 3628. A probe on the bead's own trimmed fixture gave `lent -2713` and 4628. The engine runs GIVEs
region, then object, then unit, in report order (`runorders.cpp` `DoGiveOrders`), and the fixture
lists 4868 before 4862, so 4868's GIVE back runs first. The app was right, and the expected figures
were not. Only the bead's secondary symptom (4862's upkeep) was a bug. It took a question to the
navigator to re-scope the bead.

**Why.** The expected figures were worked out by hand from the orders as written, top to bottom,
not in the units' report order.

**Cost.** About 20 minutes: a miniature test that could not reproduce the bead, then a fixture
probe and a navigator question before any fix could start.

**Prevent by.** In `skills/fix-bug/SKILL.md` *The bug-fix contract* step 1, add: when a bead's
expected value depends on the order of two orders in one phase, confirm the report order of the
units involved before writing the test.

**Seen before.** None found.

## A rebase onto main moved the fix under me twice, and once turned CI red

**What happened.** Two beads merged into the same maintenance code while this PR was open: ah-rbei
(`UpkeepSilver`) and then ah-ayg7 (separate column and warning settlements). After the first
rebase, the smoke walk "a unit told to spend silver it has not got" failed on both shells, because
the hex sentence now named upkeep. After the second rebase, the right home for the fix was ah-ayg7's
column-only hand-back, and the smoke change was reverted.

**Why.** Several beads in the maintenance step of `crates/core/src/orders/semantics.rs` were in
flight at once (ah-2zku, ah-rbei, ah-ayg7, ah-5xdk).

**Cost.** Two conflicted rebases, one red CI round, and two follow-up reviews.

**Prevent by.** Before building, `git log origin/main -- <file>` over the last day and
`bd list --status in_progress` for beads touching the same function. Seeing ah-ayg7's open PR first
would have put the fix in the column's settlement from the start.

**Seen before.** None found.
