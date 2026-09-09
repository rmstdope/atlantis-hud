# ah-6m7b.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1087

## The plan named four tests as moving; eleven had to move

**What happened.** The plan's increment 3 said "Four unit tests move out of `silver.rs`'s
`mod tests` in this increment", named them in a table with their line numbers, and explained the
reason exactly right: they construct `UnitFacts` with `phases: None`, and after this increment a
ledger-less caller prices no `BUY ALL` at all. The reason was sound and the count was not. The real
figure was ten in that file, plus an eleventh
(`a_taxed_bounded_buy_is_funded_by_the_uncontended_tax`) which fell to the `hopeful_tax` deletion in
increment 2 rather than to the seam. The count only surfaced by running
`cargo test -p atlantis-hud-core` after the GREEN, which listed ten failures where four were
expected.

**Why.** The plan named the four tests it had read, not the set a predicate selects. Nothing in
`docs/retrospectives/` or in the plan records a command that would have produced the number — the
table is four hand-picked line numbers, and a reader has no way to tell a curated sample from an
exhaustive list.

**Cost.** About twenty-five minutes: seven further re-expressions as `review_turn` cases over
hand-built reports, each needing its own fixture arithmetic measured on the tree, plus a second
round of "is this the whole set?" after the first `cargo test` run.

**Prevent by.** Where a plan says *N* existing tests move, it should name the command whose output
is *N* — here `grep -n "Amount::All" crates/core/src/orders/silver.rs` inside `mod tests`, or a
`cargo test` invocation over the affected names — so the implementer re-runs it against the tree it
actually has rather than trusting a count taken at planning time. This is the cheap half of the rule
`implement-bead`'s *When the plan is wrong* already applies to helpers and current-source claims: a
plan's **enumeration** is as much a current-source claim as a quoted region is, and is worth
re-deriving before the increment that consumes it.

**Seen before.** None found. `docs/retrospectives/ah-f9q9.md` records a plan naming four risks that
did not materialise, which is the opposite shape — an over-estimate of what would go wrong, not an
under-count of what had to change.
