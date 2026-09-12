# ah-3u7c.2.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-12
- **PR:** #1206

## The plan's verification fixture could not reach the case, and nothing said so until the end

**What happened.** The plan's *Validation* section and its Playwright test both name
`tests/fixtures/reports/neworigins-3.0.0-g3-f42-t40.rep`, unit `5480` standing in `mountain (36,4)`
beside `+ Building [1] : Fort.`, and describe the crossing being learned from it. It cannot be:
`passage_claims` (`crates/core/src/movement/passages.rs`, from the blocker `ah-3u7c.2.1`) filters on
`has_an_inner_location`, which tests for the report's `contains an inner location` qualifier, and a
Fort never carries one — `pnpm run atlantis data Shaft` versus `data Fort` confirms the distinction
is real in the game and not an accident of the parser. So the fixture stays on the unknown-passage
path and every assertion in the plan's step 3 fails.

Worse, no replacement existed: `grep -l "inner location" tests/fixtures/reports/*.rep` matches five
reports, four of them turn zero and the fifth `g7-f95-t55`, and **none has a consecutive following
turn** — which the memory requires (`scanStoredTurns`: `held.turn === key.turnNumber - 1`). The bead
went back to the navigator and then to the planner for the verification half alone, with all seven
code increments built, committed and green.

**Why.** Established. The plan was written while `ah-3u7c.2.1` was still only planned, and it says
so — *Known traps* ends with "two of the four seams this plan builds on had not landed when it was
written". That warning is about **names and shapes**, and I did check those: `PassageClaim`,
`KnownPassage`, `passageMemory.ts`, `MapKnowledge` all matched. What it does not cover is the
blocker's **behaviour**, and `has_an_inner_location` is a filter `ah-3u7c.2.1` chose for itself after
this plan's fixture was picked. A fixture is a claim about what a predicate accepts, exactly like the
helper claim `implement-bead` already tells implementers to read before building on — but the
fixture is named in *Validation*, at the far end of the plan, so the check does not happen until
everything is built.

**Cost.** Not the build, which went to plan: the whole loss is that the verification could not be
written, so the bead is split across two sessions and its browser test will be implemented by
somebody who has none of this context. Finding it cost about twenty minutes; the split costs a whole
second pass.

**Prevent by.** `implement-bead`'s *When the plan is wrong* already says a helper the plan cites for
what it decides is read before it is built on. Extend that sentence to the plan's **fixtures**, and
move the check to the front: before increment 1, run the plan's named fixture through the predicate
that has to accept it — here one `grep "inner location"` on the two `.rep` files would have answered
it in seconds. The same one-line check belongs in `design-the-build`'s *Validation* heading, since a
planner naming a fixture is asserting that a specific predicate accepts it and can prove that as
cheaply as read it.

**Seen before.** `ah-sefq` (an assertion the plan named as the guard could not fail — a single-step
`SAIL` route never reads the region index) and `ah-cklr` (a negative fixture inert because two
month-long orders in one `FORM` block trip the `ah-rzkm` lost-month filter). Both are the same
shape — a plan's chosen case cannot reach the code it is meant to exercise — and both were caught
mid-build. This is the third sighting and the first where the case was in *Validation*, which is why
it surfaced only after the whole bead was built.
