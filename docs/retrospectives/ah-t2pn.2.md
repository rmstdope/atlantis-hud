# ah-t2pn.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #625

## The plan's worked example contradicted the helper it told me to reuse

**What happened.** The plan's increment 1 named the exact figures a test should assert: *"asserts
late income of `545` and `655`"* for a 50-man and a 60-man unit against a $1,200 pool. Reusing
`split_pool` unchanged — which the same plan required — gives 545 and **654**: `1200 * 720 / 1320`
is 654.54, and `split_pool` floors deliberately, so that the shares never add up to more than the
pool. Written as the plan states it, the test would have failed GREEN and invited a "fix" to the
rounding, which is the one thing `split_pool`'s doc comment says not to touch.

**Why.** The figure was computed by hand during planning, before `ah-t2pn.1` had landed
`split_pool`, and rounded the ordinary way rather than the way the helper does. The plan flags
itself as written against a promise rather than a fact ("everything below that names `split_pool` …
is a promise, not a fact"), but only about the *types*, not about the arithmetic.

**Cost.** Small — a few minutes, caught by computing the number before writing the test rather
than after. The cost recorded here is the one that was avoided: a plan-stated expected value that
disagrees with the shared helper reads as a defect in the helper.

**Prevent by.** A plan that names expected numbers for a test should derive them through the helper
it names rather than by hand, or state the helper and the inputs and leave the implementer to
compute — `plan-bead`'s *Increments* guidance is where that belongs. This family has two beads left
(`ah-t2pn.3` markets, `ah-t2pn.4` the finding), both of which will quote worked examples through the
same flooring `split_pool`.

**Seen before.** None found.
