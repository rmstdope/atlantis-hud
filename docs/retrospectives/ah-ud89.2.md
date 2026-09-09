# ah-ud89.2 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-09
- **PR:** #1133

## The plan's third test fixture could not produce the behaviour it was written to pin

**What happened.** Increment 3's fixture C was specified exactly: fixture A's report plus
`STUDY combat` on the taxing unit, expecting *buys 10, no `not-enough-silver`, `at_month_end ==
Some(-100)`, `short_for_orders == Some(100)`*. Built as written it fails, and not marginally: a
studying unit's `readiness` is zero, so `taxing_men` (`silver.rs:3896`) counts none of its men, its
income is `0`, it buys nothing, and there is no contended share left for this bead to settle at all.
The fixture pins nothing about the change it was written for. I then measured the intended case both
ways — with the subtraction and with it neutralised — and found that **no `not-enough-silver` moves
for a `BUY ALL` under any fixture**: a `BUY ALL` is sized by the purse it is about to spend, so it
cannot overdraw the hopeful ledger balance whichever reading the cap uses. The navigator's `W1`
decision is real for the family but costs a `BUY ALL` nothing.

**Why.** The plan derived fixture C's numbers from the study fee arithmetic without running the
fixture, and the two figures it predicted (`-100`, `100`) are indeed what that fixture produces —
for the study fee, with the tax gone. Predicted numbers that happen to be right for the wrong reason
are the hardest kind to catch by reading.

**Cost.** About 25 minutes: three measurement cycles establishing what the fixture actually does,
then designing a replacement and defending it through two review rounds.

**Prevent by.** `plan-bead`'s *The test plan*: a fixture written to pin *a warning that stops
firing* should say which run was measured to see it fire. More narrowly and checkably — a plan that
adds a month-long order (`STUDY`, manufacturing `PRODUCE`) to a unit whose **tax** is the subject of
the test has changed what that unit taxes, and the plan should say so or pick another lever. `CAST`
is not in that position, which is why `ah-ud89.1`'s fixtures could use it.

**Seen before.** `ah-ud89.1` — the same family, the same plan, two sections of its own retrospective
on acceptance criteria and fixtures that could not hold as written (and `ah-sdjy`, `ah-rgkk.2.1`,
`ah-1wcw.1` before that). This is the third sighting in this family alone, and the second in this
bead's own parent, which is why it is recorded rather than absorbed.
