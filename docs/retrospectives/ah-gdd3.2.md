# ah-gdd3.2 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-04
- **PR:** #910

## Three of six focused tests passed against the unfixed code, and only the reviewer caught it

**What happened.** The plan named five focused tests; I wrote them as specified and all passed. The
cold-read reviewer reverted each surface and found that only `a_claim_funds_the_months_manufacturing`
went red. `a_gift_written_under_a_produce_is_still_spent_first` and
`a_cast_lowers_what_a_production_can_afford` were inert, and the latter was the **only** test
anywhere for the bead's third required regression.
**Why.** Established. Each asserts `produced == 0`, and the fixture the plan specified put the silver
in the scalar `UnitFacts.held` while giving `items` a slice with no `SILV` line. The old cap read
that slice, so it was already 0 and already produced none: the test could not distinguish the fix
from the bug. Fixed by giving the slice the unit's own `SILV` line — which is what a real report
prints anyway — and pairing each with a control that drops the spending order and asserts
`produced == 1`.
**Cost.** One review round and about fifteen minutes. Cheap only because the reviewer mutation-tests
rather than reads.
**Prevent by.** A test whose whole assertion is that a number is **zero, absent or empty** cannot
show it has teeth. Before the PR opens, revert the change and confirm each new test goes red — the
reviewer will do it anyway, so doing it first costs a round less. Worth `implement-bead`'s *Building*
section saying so directly: the RED step proves the test fails before the fix *exists*, which is not
the same as proving it fails against the **old behaviour**, and for a negative assertion the two
routinely differ.
**Seen before.** `ah-ycuj`, `ah-qled.4`, `ah-3mwm`, `ah-enik`, `ah-lu0f.3`, `ah-dlao` — six prior
sightings of an assertion that was vacuous or passed against the unfixed code, most of them caught
by a reviewer rather than by the implementer. This is the strongest evidence in the directory that
something needs fixing rather than tolerating.

## The plan forbade moving any test expectation, and the code it mandated necessarily moved one

**What happened.** The plan's *Known traps* said "No existing test expectation may be changed by this
bead", on the premise that only `CATP` and `STED` take silver and no committed fixture orders either,
so "nothing in the corpus can legitimately move". `semantics::tests::a_unit_that_cannot_afford_its_production_is_warned`
does order `PRODUCE catapult`, after a `BUY`, and the formula the plan mandates in explicit code
(`available_silver(held, income, expense + market_expense)`) necessarily inverts its assertion.
**Why.** Established. The premise was checked against `crates/fixtures/` and not against the
in-module tests. The trap and the mandated code contradict each other outright: no implementation
satisfies both.
**Cost.** One question to the navigator and about ten minutes. It would have been a whole cycle had
they been away, since the trap's instruction is to hand the bead back.
**Prevent by.** A plan asserting that no existing expectation can move should name how it was
checked, and the check must cover in-module tests — `grep -rn "PRODUCE catapult" crates/` answers
this bead's claim in one command, and contradicts it. Better still, a trap that forbids something the
plan's own code requires is a contradiction a planner can find by reading its two halves together.
**Seen before.** None found for this shape — prior sightings are of plans that were *incomplete*
rather than self-contradictory.

## Two sibling beads changed the same two call sites in parallel

**What happened.** `ah-l80z` (materials bought or sold this month count toward manufacturing) merged
while this PR was in review. It gives `plan_production`'s **material** slice a running
pre-manufacturing balance at exactly the two call sites where this bead gives its **silver** one, and
had rewritten the same test for the same reason. The rebase conflicted on all four commits; a single
`git merge origin/main` resolved it once instead of four times. Both changes composed cleanly, but a
follow-up review round then found that ah-l80z's `held` now carries the same phase's balances, so
nothing would notice this bead's ledger read being reverted.
**Why.** Established. `ah-gdd3` was split into siblings by the surface they correct (silver, materials)
rather than by the code they touch, and the two surfaces are computed in the same two functions.
**Cost.** About twenty-five minutes: a four-way rebase abandoned for a merge, a resolution composing
two beads' logic, and one extra review round to check the composition.
**Prevent by.** When a split puts two children in the same function, `bd dep add` should order them
so the second starts from the first's merged code — the dependency was declared here ("Depends on the
shared phase model … its sibling introduces") but only against `ah-gdd3.1`, not against `ah-l80z`,
which touches more of the same lines. Worth the planner checking, for each sibling pair, whether the
*files* overlap and not only the concepts.
**Seen before.** None found naming two siblings of one split colliding in the same function.
