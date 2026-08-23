# ah-1wcw.4 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #569

## Charging every unit a new default cost broke 157 fixtures and 3 smoke walks the plan did not foresee

**What happened.** The plan said, correctly, that `ledger_for` should charge every unit its monthly
maintenance, and that this changes a shipped, default-on warning. What it did not say is how much
already-written test data that touches. The moment upkeep was charged, `cargo test -p
atlantis-hud-core` went from green to **157 failures**: the `semantics.rs` fixture `unit()` builds a
one-man unit holding no silver, so every hex in every unrelated test began warning
`not-enough-silver`. Later, CI found three smoke walks whose problem counts move for the same
reason, none of which the fast gate runs.

**Why.** A per-unit cost charged unconditionally is a change of baseline, not a new branch: it
applies to every fixture unit that exists, including all the ones standing up something else
entirely. Nothing in the plan's *Increments* or *Known traps* named that, and the finding-count
prediction it did make (that the real turn's `EXPECTED` table would not move) was measured
faction-wide while the check is per hex — two hexes hold no silver at all, so the table moved by two.

**Cost.** About an hour on the fixtures, a full local smoke run to find the right counts, and two CI
cycles. No wrong code shipped: the fixtures were fed (one grain and `consuming unit's food`, which
pays a one-man fee without moving any fixture's silver) rather than the rule being weakened.

**Prevent by.** A plan that adds a cost or income term charged to **every** unit unconditionally
should say so under *Known traps*, and its *Test plan* should name the fixture helper the change
lands on — here `semantics.rs`'s `unit()` — plus the smoke walks that assert problem counts on the
committed turn (`workspace.spec.ts` around the `problems-chip`). Both are one grep at planning time
(`grep -n "fn unit(" crates/core/src/orders/semantics.rs`, `grep -n "problems" tests/smoke/*.spec.ts`)
and would have turned an hour of surprise into a paragraph.

**Seen before.** None found — `ah-1wcw.1`, `.2` and `.3` all added terms to the forecast without
touching the ledger, so this is the first child of the epic to change what a shipped warning counts.
