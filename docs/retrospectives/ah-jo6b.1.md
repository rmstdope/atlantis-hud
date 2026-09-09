# ah-jo6b.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-09
- **PR:** #1101

## The plan fenced a file the change could not avoid editing, and named the wrong assertion as the risk

**What happened.** The plan listed `crates/core/src/orders/transfer_agreement.rs` under *"Must stay
green untouched, and each is a real risk"*, and its Validation criterion 5 required that test green
**"with no edit to any of them"**. It named one assertion as the danger — `assert!(uncertain > 0)`,
the `LedgerUncertain` floor — reasoning that those exemptions came from the corpus's *foreign*
gifts, which this bead does not touch.

Both halves were wrong, and measurably so. `cargo test -p atlantis-hud-core --lib
the_corpus_actually_exercises_the_agreement` failed first on `LedgerDoubted exemptions: 0`, an
assertion the plan never mentioned; fixing that revealed `LedgerUncertain exemptions: 0` behind it.
All nine `LedgerDoubted` and all five `LedgerUncertain` in the corpus came from **unshown-target**
gifts — precisely what this bead dissolves — not from foreign ones. So the fenced file had to be
edited for the bead to build at all, and the Validation criterion was unsatisfiable as written.

**Why.** The plan asserted where the corpus's exemptions came from without measuring it. The two
counts are only visible by instrumenting that test; the plan's line numbers were measured on
`4d3f0e00`, but this claim was about runtime counts, and nothing in the planning pass ran them.

**Cost.** About twenty minutes: two rounds of discovering a zeroed floor one at a time, then
deciding whether dropping two floors was mine to decide or a hand-back. The review round then spent
its top finding on the same ground — correctly, since the first fix left `LedgerDoubted` covered by
nothing — costing a second delta round to answer.

**Prevent by.** When a plan fences a file as *must stay green untouched*, it should say what to do
when that proves impossible, rather than leaving an implementer to infer whether an unavoidable edit
is a hand-back. `plan-bead`'s *Validation* section is where that belongs: a criterion of the form
"X stays green with no edit" is a prediction, and a prediction the plan has not run is worth marking
as one. Separately, a plan that names a runtime count as its risk (`assert!(n > 0)` over a corpus)
should measure that count during planning — it is one instrumented test run — because naming the
wrong assertion is worse than naming none: it aims the implementer's attention away from the failure
that actually comes.

**Seen before.** None found. `grep -rl "must stay green untouched\|coverage floor" docs/retrospectives/`
returns nothing.
