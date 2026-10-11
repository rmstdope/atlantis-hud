# ah-9n7l.2 — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-11
- **PR:** #1496 (rework of #1466)

## The bug log promised agreement between two surfaces that only one test checked

**What happened.** Round one (#1466) fixed the SILVER column so that a sale no longer funds an
earlier CAST. Its bug log told the verifier the column would show the cast short "in agreement
with Problems". Every reproduction test asserted the column only (`short_for_orders`). The
not-enough-silver judges in `semantics.rs` had the same defect: no reading at the CAST phase. A
lone caster therefore got no warning at all, and in a sharing hex the cast dropped out of the
hex's shortfall. The verifier found the disagreement by hand, on G3_F42_T40, and the bead came back
at P0.

**Why.** The bug was stated in terms of the column, and the fix and its tests followed that
statement. The column and the ledger are two separate computations of the same economy
(`tests/silver_agrees_with_the_warning.rs` says so). A promise about both of them was written into
the by-hand steps without a test that read the second one.

**Cost.** One failed verification of the navigator's time, a P0 reopen, and a second full
review-and-CI cycle. The rework also turned up a third reader with the same gap (the walking-sharer
loan sizing) that the first round never touched.

**Prevent by.** In `skills/fix-bug` *Logging the bug*: every surface named in *How to trigger it by
hand* must be one that *How the test triggers it* asserts. A silver fix that names the Problems list
needs a `review_turn(..).findings` assertion as well as a `silver` one.

**Seen before.** ah-6m7b.1 (a plan's claim about two surfaces that a test could not reach) is a
relative, but it was about reachability, not about an unasserted surface.
