# ah-lu0f.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #666

## The plan's regression test passed on main, for two reasons at once, and only a deliberate check found it

**What happened.** Increment 4's test — a mage with no silver casting an earning spell and then
buying — was written exactly as the plan specified it and passed straight away, before any ledger
change was made. Two independent causes:

1. `"CAST Phantasmal Entertainment"` names a spell with a space, and this repository's order parser
   wants `CAST Phantasmal_Entertainment` (every other CAST test in `semantics.rs` uses underscores).
   The unparsed order left a `unit-does-nothing` finding rather than a failure, so the test looked
   merely green.
2. With the spell parsed but the ledger still crediting nothing, the plan's `BUY 5 grain` ($500)
   *still* raised no `not-enough-silver`; $1,000 does. The shortfall threshold is not the plain
   `balance < 0` the plan assumes, and I did not establish what absorbs $500.

Neither shows up as a failing test. The only thing that caught it was reverting the fix and
re-running — which the TDD loop only enforces when RED is observed *before* the code, and increment
4's RED was observed against a version of the test that was wrong for reason 1.

**Why.** Established for cause 1 (the parser wants underscores). Not established for cause 2 — I
tuned the fixture to $1,000 rather than diagnosing which rule absorbs the smaller shortfall, which
means the test pins the fix but not the boundary.

**Cost.** About 40 minutes of the run, and five extra `cargo test` cycles. Nothing reached CI, and
no CI cycle was spent on it.

**Prevent by.** Two specific things:

- Where a plan supplies fixture *text* for an order (`plan-bead`'s increments), give it in the form
  the parser accepts — underscores for multi-word spell and item names. A plan that writes
  `CAST Phantasmal Entertainment` produces a test that passes for the wrong reason.
- After a RED→GREEN increment whose test is a *behaviour change* rather than a new function, revert
  the one line that implements it and confirm the test goes red again. `implement-bead`'s TDD loop
  does not currently say this, and here the first RED was not evidence about the finished test.

**Seen before.** `docs/retrospectives/ah-ycuj.md` — a corpus assertion vacuously true for 758 of
1,392 units, found by the reviewer rather than by the suite. Same class: a green test that asserted
nothing. This is the second sighting.
