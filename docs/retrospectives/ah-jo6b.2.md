# ah-jo6b.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PR:** #1104

## I declared a plan's defect unreachable on the strength of one fixture, and weakened its test

**What happened.** The plan's third increment asserted that with no catalogue loaded the SILVER
column shows a confident, wrong figure for `GIVE <n> ALL ITEMS`. Written as the plan specified, the
test failed: the column carried `SilverDoubt::EstimatedMen` and named no figure at all. I measured
the row with the fix applied and again with it reverted, saw them identical, concluded the defect was
not reachable through `review_turn`, replaced the plan's assertion with a weaker one pinning the
blank column, and wrote the conclusion into the PR body as a recorded deviation.

The review sub-agent reproduced my measurement, then read `silver.rs:1522`: the estimated-men
short-circuit fires only when the unit is *set to work*, which a unit whose only order is a `GIVE`
is. Adding `MOVE N` to the script, the column prices the month — and before the change reads
`at_month_end = Some(100)` for a unit that had given every coin away. The plan was right; my two
measurements had both been taken through the same blind fixture, so agreeing with each other proved
nothing.

Following the reviewer's route then showed case 2 was player-visible by the same kind of fixture
choice: with a market line in the report, reverting the `!is_give` gate discards the unit's
`BUY ALL` settlement and the column shows an unspent purse.

**Why.** A measurement that a change makes no difference is evidence about the *fixture* as much as
about the code. Both of my runs went through `giver(900)` with a lone-GIVE script, so both hit the
same short-circuit; running the pair before and after felt like a controlled experiment and was one
with the wrong control. Nothing in the loop asks "could this fixture show the difference at all?" —
and the answer, for a surface that blanks a whole row on one flag, is often no.

**Cost.** About 25 minutes: the wrong measurement, the replacement test, a PR body paragraph that had
to be withdrawn, and one review round plus one CI cycle that would otherwise not have been needed. No
wrong code shipped — the two production hunks were correct throughout, and only the tests around them
were weak.

**Prevent by.** In `implement-bead`'s *When the plan is wrong*, treat "the plan's assertion does not
hold on this tree" as a claim needing the same proof as a source claim: before weakening or replacing
a planned assertion, show the fixture is *capable* of distinguishing the two states — find the guard
that blanks it and name it, or vary the fixture until something differs. A before/after pair that
agrees is not evidence the behaviour is the same; it is evidence the fixture cannot see it, until the
blinding guard is identified.

**Seen before.** `ah-cklr` — one fixture guarding two checks, where a mutation failing on one
assertion said nothing about the others. `ah-rgkk.3.3` — expectations derived from the change being
made, which "encodes the same assumption twice"; the same reviewer named a weakened test there too.
