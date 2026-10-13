# ah-pf7t — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-13
- **PR:** #1539

## The agreement test meant to catch a re-derived lending had one lender, and missed two regressions in the refactor itself

**What happened.** The bead put "what a SHARE sharer lent" in one home (`Lending`). It also added a
cross-consumer agreement test, so that a reader re-deriving the lending would fail before review.
That test was green, and the cold-read review still found two blocking TRANSPORT regressions in the
refactor:

- A CAST nobody could fund was drained from the sharer.
- A lender's refused STUDY was judged on its raw row, which still counts what it lent. That is the
  very reading the new doc on `balance_at` warns against. Its silver was then taken from a second
  sharer.

The agreement test's hex had one lender holding silver, and its only unaffordable order came after
that lender was empty. Neither path was reachable from it.

**Why.** The test was designed around the consumers the acceptance lists, not around the rules the
purse applies: all-or-nothing coverage, refusal, drain order across lenders. A rule only shows up
when the fixture can break it. With one lender and every spend fundable, "drain the remaining
overdraft" and "lend nothing past an uncovered moment" give the same figures.

**Cost.** One extra review round, one fix push of about 150 lines and four tests, a follow-up
review, and a follow-up bead (ah-szu0) for a limitation main already had. About an hour.

**Prevent by.** In `produce-bead`'s *The plan*, under *The test plan*, for any test in
`crates/core/src/orders/semantics.rs` that claims SHARE readers agree, the fixture must hold:

- at least two lenders holding silver;
- one spend the pool cannot fund (a CAST or a STUDY);
- a lender that is itself a spender;
- both report orders.

That extends ah-lnz4's both-orders rule and ah-0mch's second-spender rule from one spend to the
pool's own rules.

**Seen before.** ah-0mch (a single-spender test cannot see a second reader), ah-lnz4 (both report
orders), ah-su1x (re-derived lending dropping one purse rule at a time). This one is the same cause
one level up: the test meant to stop re-derivation had the single-lender blind spot.
