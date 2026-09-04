# ah-cklr — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-04
- **PR:** #917

## A negative fixture was inert for a reason the plan did not anticipate

**What happened.** The plan's increment 3 asked for a guard test with one `FORM` block carrying
both `STUDY QUAM` and `PRODUCE grain`, and asked me to prove it bites by temporarily making
`spends_faction_allowance` return `true`. Under that mutation only the trade-region half failed;
the quartermaster half never fired. A `panic!` printing the emitted codes showed why: a block with
two month-long orders earns `two-month-long-orders`, and a unit that lost its month asks for no
quartermaster place (`ah-rzkm`) — so the quartermaster assertion could never have failed, for a
reason unrelated to dissolution. Split into two `FORM` blocks (`FORM 1 / STUDY QUAM / END`,
`FORM 2 / PRODUCE grain / END`) with the report producer dropped and `Trade Regions` maximum 0,
both halves then bite.
**Why.** Established. Two month-long orders in one block interact with the `ah-rzkm` lost-month
filter, which the plan's fixture design did not account for.
**Cost.** About ten minutes and three extra `cargo test` runs.
**Prevent by.** When a plan asks for a single fixture to guard two different checks, prove each
assertion bites *separately* — neutering the earlier assertions one at a time — rather than
stopping at the first failure the mutation produces. A mutation that fails on one assertion says
nothing about the others.
**Seen before.** This bead's own earlier attempt (PR #894) had an inert negative fixture raised as
a review finding, though for a different cause.
