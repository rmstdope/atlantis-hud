# ah-6m7b.3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1093

## The plan named five unit tests to move; thirteen failed — the same finding the previous child of this epic already recorded

**What happened.** `ah-6m7b.3`'s plan listed five tests in `crates/core/src/orders/silver.rs`'s
`mod tests` to move out, and two to rewrite. Once the SILVER column stopped settling
`GIVE ... ALL SILV` for itself, `cargo test -p atlantis-hud-core --lib` failed **thirteen** — every
test that fed `forecast_unit` a `phases: None` `UnitFacts` and asserted `ALL`-gift arithmetic. I had
to classify the extra eight myself (nine moved, two deleted as already covered cross-surface by
`give_all_silver_precedes_the_tax.rs` and `…_the_study.rs`, two rewritten in place with a `gifts`
slice) and build integration fixtures for each — including working out that `rules/pillage` needs
enough combat-ready men to tax half the hex, and that a report unit line with no items at all makes
`preview_orders_for_remembered_report` return no regions.

**Why.** `docs/retrospectives/ah-6m7b.2.md` — the immediately preceding child of this same epic —
records this exact finding, with the same shape and a *Prevent by* asking that a plan naming *N*
moving tests also name the command whose output is *N*. That prevention was written into a
retrospective and did not reach the next plan in the same family. The plan for this bead again gave
a hand-picked list with no command behind it.

**Cost.** About forty minutes: eight further re-expressions as `review_turn` cases, each with its
own fixture measured on the tree, plus two rounds of "is this the whole set?".

**Prevent by.** A retrospective is not a channel to the next planner. `plan-bead` should require
that a plan naming a set of existing call sites or tests to change carries **the command that
produced the set**, and `implement-bead`'s *When the plan is wrong* should name an enumeration
alongside the helper and current-source claims it already tells an implementer to re-derive before
the increment that consumes it. Both are the navigator's to make — this entry only records that the
same cost was paid twice, one bead apart, inside one epic.

**Seen before.** `docs/retrospectives/ah-6m7b.2.md` (same epic, previous child, same finding).
`docs/retrospectives/ah-12h7.md` and `docs/retrospectives/ah-3ej.md` record the same species for a
plan's enumeration of comments and of call sites.
