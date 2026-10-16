# ah-9yvv — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-16
- **PR:** #1639

## A TRANSPORT-moment lending error does not show at the month's end

**What happened.** The review found that the code splitting shipment draws into those made before and those made after the fees (`Lending::settle`) had no test that failed without it. Two tests asserting the lender's and the sender's month-end silver both passed with the split removed, even though instrumenting the fold showed the TRANSPORT moment lending the wrong amounts. The month-end purse moment re-lays every remaining overdraft on the lenders, so it repaired the attribution before any SILVER column figure was read. Even making the month's end short, so that the purse would stop lending there (`ah-e66j`), did not expose it. What finally did was a second exact silver line reading `Lending::through(Transport)` after the draw: with the split removed, that line shipped 10 that did not exist.

**Why.** Every surface a test can easily assert, the SILVER column's changes and `at_month_end`, is read after the month-end moment. That moment lends again from the positions it is given, so a wrong TRANSPORT-moment fold can produce the same final rows.

**Cost.** Three test iterations, plus `eprintln!` instrumentation of the fold, before a scenario failed under the mutation. About twenty minutes.

**Prevent by.** A section in `packages/shared/src/testing/README.md`'s Rust counterpart (or a doc comment on `Lending::settle`) stating that a TRANSPORT-moment lending change is only observable through a later TRANSPORT reading — another shipment's quantity or a fee's verdict — and never through month-end figures. A plan touching the fold names such a test from the start.

**Seen before.** `ah-ayg7` met readers of a shared ledger field after settlement disagreeing about which side they belonged to; not the same symptom.
