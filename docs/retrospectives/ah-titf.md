# ah-titf — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-25
- **PR:** #680

## The plan derived a rule from real reports, and the test fixtures do not have their shape

**What happened.** The plan specified that the new derived capacity should fall back to the
report's printed line in exactly two cases: no ruleset, and a tag the ruleset cannot price. It
derived and validated the rule twice against real data — the fixture report's own printed
`Capacity:` line and the reporter's figures — and both were correct.

Implementing it exactly as written turned **nine existing tests** in `orders/semantics.rs` red with
invented overload warnings. The cause is that `semantics.rs`'s `unit()` fixture carries `men: 1` as
a headcount field and lists **only one grain** in `items` — it names no man item at all. Deriving
capacity from that item list gives 0, because grain contributes nothing, so every fixture unit that
moves became overloaded. In a real report a unit always lists its men, which is why validating the
rule against real reports could not surface this.

**Why.** Established. `ReportUnit` carries the headcount in `men` and the item list separately, and
the fixtures populate the first without the second. A rule that reads capacity off the item list is
therefore correct on real input and wrong on every fixture.

**Cost.** About twenty minutes: one full-suite run to discover it, one to locate the fixture, and a
design decision beyond the plan — `capacity_after_orders` also returns `None` when the listed
man-items are fewer than `unit.men`, which is defensible on its own terms (a list that undercounts
men understates capacity, and understating capacity is the failure being fixed) but is not what the
plan asked for. No CI cycles: the fast gate caught it locally.

**Prevent by.** A plan whose rule reads a field the test fixtures populate differently from real
reports should say so in its *Known traps*. Concretely, for this repository: when a plan derives a
value from `ReportUnit.items`, it should check `semantics.rs`'s `unit()` fixture (`:8490`) and state
what that fixture holds, because it is the input to roughly 1,400 tests and it is not shaped like a
real unit. The plan's *Known traps* section listed five real traps and none of them was this one.

**Seen before.** `ah-1wcw.4` — same shape: a change correct on real input broke 157 fixtures the
plan did not foresee, because the fixtures are not shaped like real reports.
