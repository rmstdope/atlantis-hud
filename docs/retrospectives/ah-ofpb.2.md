# ah-ofpb.2 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-26
- **PR:** #718

## The plan's design pseudocode contradicted its own settled decision

**What happened.** The plan's numbered step 2 (under *The design of the code*) says a `BUILD HELP`
naming a unit with no `BUILD` order at all should "mark uncounted and return." But the plan's own
settled decision — stated in the "One consequence of G1" paragraph near the end, and again in the
increment 6 test list, both explicitly and with the reasoning spelled out — says the opposite: that
case is a known zero, so the row should stay upright and unmarked, and names the exact test
(`a_build_help_of_a_unit_that_is_not_building_records_nothing`) that pins it. The two parts of the
same plan disagreed about one branch's behaviour.

**Why.** Not established with certainty, but the shape suggests the design pseudocode was written
before the "One consequence of G1" decision was settled with the navigator, and the pseudocode was
not updated to match once the decision landed.

**Cost.** About ten minutes of re-reading to notice the contradiction and decide which side to
trust — no wasted implementation, since I built to the decision paragraph and the test name (both
explicit and mutually reinforcing) rather than the pseudocode line, and every test passed on the
first run against that reading.

**Prevent by.** When a plan settles a decision with the navigator after its design section is
drafted, re-read the design section's own pseudocode for spots the new decision should have
changed, specifically prose that states behaviour for the same branch a later round's decision also
addresses — `plan-bead`'s own drafting step, not this bead's to fix.

**Seen before.** None found.

## A plan's literal test-fixture code did not match the helper it named

**What happened.** The plan's increment 3 said to add a `report_with_a_builder()` fixture returning
a raw multi-line report `String` (header, `Exits:`, a `+ Building [4]` structure line, a `*` unit
line) and use it with the `with_ledger` helper in `semantics.rs`'s `item_movements` test module.
`with_ledger`'s actual signature takes an already-parsed `ReportRegion`, not report text, so the
plan's literal fixture code would not have compiled against the helper it names.

**Why.** The plan's own increment 7 (in `effects.rs`) needs a raw-text fixture, since `preview_over`
there really does parse full report text — the increment 3 fixture reads as if it were copied from
that context without checking `with_ledger`'s signature in the target file.

**Cost.** A few minutes reading `with_ledger` and the file's existing `ReportRegion`/`ReportUnit`
composables (`unit`, `with_men`, `with_item`, `with_skill`, `in_structure`) to build an equivalent
fixture with the same scenario and numbers. No wasted implementation.

**Prevent by.** `plan-bead`'s own drafting step, per the implement-bead skill's existing guidance on
reading a cited helper before building on it: when a plan writes literal fixture code for a named
test helper, check that helper's actual signature in the target file rather than assuming the
pattern from a sibling module carries over unchanged.

**Seen before.** None found.
