# ah-3c2t.3 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-09
- **PR:** #1154

## A guard test I wrote in answer to a review finding could not fail

**What happened.** The review's finding 3 was that the new arm's gate tested `income_doubt` alone
while its comment claimed the arm covered "a unit whose only doubt is a contended tax pool". I added
`expense_doubt.is_none()` and wrote
`a_unit_doubted_on_both_sides_reports_no_buy_all_even_when_the_purse_fell_back` to pin it, with a doc
saying "this test is what fails if either that or `forecast_unit`'s own `expense_doubt` guard is
narrowed". I checked the scene was not vacuous — it asserts `expense == None`, so the expense side
really is doubted — but I never ran the mutation. The next review round did, in about a minute:
delete the guard, the test still passes, because `facts.settled_buy_all()` is already empty for that
unit through the ledger's own `doubted` set.

Probing seven order shapes afterwards showed **no** scene can isolate that guard: each either doubts
the unit in the ledger too, or doubts a *sharer*, which makes the purse untrusted so the column sees
`SharedMarket::Unmeasured` rather than `HeldOnly` and the case leaves the arm by the other condition.
So the honest fix was to keep the guard (the arm should not lean on another module's coupling) and
rewrite the doc to claim only what the test verifies.

**Why.** I checked the test was *non-vacuous* — that its scene really reached the state described —
and treated that as evidence it was a *guard*. Those are different properties. A test can exercise
exactly the right state and still be held green by something other than the line it claims to pin,
which is precisely what a coupling in another module does.

**Cost.** One review round and one CI cycle, about twenty minutes. Left as written it would have cost
nothing visible and shipped a test whose comment asserted the opposite of what it did.

**Prevent by.** `implement-bead`'s *Answering it, and going on* should ask for the mutation on any
test written as the answer to a finding, not only on one a plan names as a guard: make the mistake
the test claims to catch, watch it fail, put it back. `ah-sefq` already asked for this where the
*plan* names the guard, and its `Prevent by` is one day old — the gap this bead found is that a test
invented mid-review to answer a reviewer is exactly as likely to be inert, and has nobody's plan
behind it to prompt the check. Two commands, and the second reviewer spent under a minute doing what
I had not.

**Seen before.** `ah-sefq` — same failure, same remedy, filed the same day, for a guard the plan
named rather than one written in answer to a review. `ah-cklr` — "A negative fixture was inert for a
reason the plan did not anticipate", the same class one step removed.
