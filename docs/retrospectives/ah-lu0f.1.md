# ah-lu0f.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-24
- **PR:** #647

## The plan named a behaviour claim as needing checking, I did not check it, and only the reviewer did

**What happened.** The plan's design for `semantics::credit_tax` said, in a code comment it wanted
carried into the source: *"an unknown tax base credits nothing, which is already the pessimistic
direction for a shortfall. Behaviour on `main` today."* It then added, in bold, **"Check that last
claim against `main` before relying on it."**

It was false. On `main` `credit_tax` read
`let ceiling = hex.region.tax_base.unwrap_or(i64::MAX);` and credited `men * TAX_PER_MAN` capped by
that — so an unstated tax base credited the taxer its *full* ask, not nothing. Routing the term
through the new `price_tax` with `tax_base: None` returned `earns: 0` with an `UnknownTaxBase`
doubt, and `credit_tax` discarded the doubt, so every taxer in an unstated-base hex that also spent
silver gained a false `not-enough-silver`. I had read that exact `unwrap_or(i64::MAX)` line an hour
earlier while surveying the call sites, transcribed the plan's comment anyway, and shipped it in a
PR whose body said "Behaviour: None".

Nothing in the repository's own net caught it. The whole core suite, the `codes::ALL` fixture sweep
and — most importantly — `crates/core/tests/silver_agrees_with_the_warning.rs`, the corpus
cross-check this epic is gated on and which two whole beads (ah-ycuj, ah-8l9a) were spent building,
all stayed green. The 26-turn corpus evidently contains no own taxer in a region with no stated tax
base, so the case the change broke is one the cross-check cannot see. Copilot found it by reading
the diff against `main`, in the first review.

**Why.** Established. Two things had to line up. The plan asserted a behaviour claim and flagged it
as unverified in the same breath, and a flagged claim reads as *handled* rather than as *homework* —
the bold sentence made it feel already accounted for. And the increment that changed `credit_tax`
was the one increment of four that the plan gave no new test of its own: increment 3's two named
tests both pin the *contended pool* divergence, and neither touches an unstated base, so there was
no RED step in which the discrepancy could have surfaced.

**Cost.** One review round and one extra CI cycle, about 25 minutes. Cheap only because the reviewer
happened to read the removed line rather than the added one — a review that had commented on style
would have merged a silent false-warning regression into the surface whose entire purpose
(`semantics.rs:13-17`) is not raising false warnings.

**Prevent by.** Two changes, both to `plan-bead`'s planning of a behaviour-preserving refactor:

1. **A plan must not state a behaviour claim it has not verified.** Where the planner cannot check
   it, the claim belongs in *Known traps* phrased as a question for the implementer to answer
   ("confirm what `credit_tax` credits when `tax_base` is `None`, and pin it before changing it"),
   never in the design as an assertion with a caveat attached. An assertion plus "check this" is
   read as an assertion.
2. **Every increment that moves an existing arm onto a shared seam needs its own characterisation
   test, written and seen green against `main` first** — not only the increments that change
   something interesting. Increment 3 got that treatment for the divergence the plan was worried
   about and got none for the `None` path, which is precisely where it broke. `pillaged`,
   `Uncontended` and `Share` were all covered; `None` was the one input with no ledger-side test.

A third, for the navigator rather than a planner: the corpus cross-check is load-bearing for this
epic and it does not cover an unstated tax base. ah-lu0f.2, .3 and .4 will each move more arms onto
this seam trusting that gate. Whether the corpus should be extended, or the gate's blind spots
documented alongside it, is a decision above an implementer.

**Seen before.** `ah-19l2.2` — "The plan's Validation section asserted a fixture fact that was not
true, and it was the bead's whole point". Same shape: a plan stating as fact something about
existing behaviour that nobody had run.
