# ah-7cdt — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #575

## The plan's doubt rule put `?` on figures that were exactly known, and only the real turn found it

**What happened.** The plan specified step 2's rule as all-or-nothing: where the hex's faction-food
pool cannot feed every claimant, every claimant's upkeep becomes `?`. It named
`an_empty_hex_pool_leaves_every_claimant_doubted` as one of increment 1's tests, so I wrote and
passed it. Increment 4 then went red: `validate_real_orders.rs` showed the committed turn's total
maintenance dropping from 2,140 to 1,590, because hex `1:26,52` holds 22 own units, 11 of them
flagged `consuming faction's food`, and **no food at all**. The plan's rule doubted all eleven —
figures that are not ambiguous in the slightest, since with no food nobody eats and each unit simply
pays its own silver. The navigator reversed the rule for an empty pool. Adversarial review then
found the same defect one step along: a *lone* claimant against a short pool was also being doubted,
though with one contender there is nothing to decide — it eats what there is and owes the rest. The
navigator reversed that too, by the same reasoning.

**Why.** The plan derived the rule from one worked example — two units owing 60 and 80 against a
pool of 3, where the total genuinely differs by who eats — and generalised it to every short pool.
The generalisation is wrong wherever the pool has no choice to make: no food, or nobody to choose
between. The example was sound; nothing tested it against the degenerate cases or against the
committed turn, which contains only the degenerate case.

**Cost.** About 40 minutes and two navigator questions mid-build. No CI cycles: both were caught
before the PR opened, the first by a test the plan itself asked for and the second by the REFACTOR
review.

**Prevent by.** When a plan decides *when the interface says `?`*, its increments should include the
degenerate inputs of that rule — zero, and one — alongside the worked example the navigator was
shown, and `plan-bead` should run the proposed rule over the committed turn before writing it down.
The real turn was the only reason the first of these was caught at all, and it caught it by
accident: increment 4 exists to prove the turn is *unmoved*, not to audit the rule. A plan that
predicts "the real turn is untouched by this bead" is making a checkable claim, and checking it
while planning would have surfaced eleven doubted units before a line was written.

**Seen before.** `ah-1wcw.1` — same family, a plan making a factual claim about the fixtures that
its own measurement contradicted.
