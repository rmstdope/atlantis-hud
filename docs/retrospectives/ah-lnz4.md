# ah-lnz4 — retrospective

## The planned path tests were green before the change, and report order was never varied

**What happened.** The plan opened increment 3 with a RED test for a sale after a neighbour's
overdraft. Written, it passed on main, and so did its CAST twin. The transfer walk's `early_holding`
and the old pool clamp already gave those answers. The increment then went in under tests that could
not fail. The defect it introduced, and the one main already had, was found only by the cold-read
review. `SharerStock::lenders_to` laid overdrafts on the *other* lenders, while the walk drains the
spender first when it is listed first. A sharer listed before its fellow sharers therefore had one
overdraft taken off it twice, and sold 0 instead of 10.

**Why.** Every two-spender test had the spender listed *after* the sharer it drew on, the one order
in which "the others first" and "report order" agree. Two readings of the same stock (the walk and
the ledger-derived reading) were each tested alone, never against each other across orderings.

**Cost.** One review round, one fix push, and two more tests. About twenty minutes.

**Prevent by.** In `produce-bead` step 3, a RED test that comes out green is a stop sign: find the
case the change actually alters before building on it. For any `SHARE` test in
`crates/core/src/orders/semantics.rs`, write each two-spender case in both report orders (spender
before and after the lender).

**Seen before.** Not under this symptom. ah-0mch's retrospective names the cause (lenders' rows are
not debited), not the ordering.
