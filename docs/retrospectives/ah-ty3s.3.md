# ah-ty3s.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-05
- **PR:** #985

## The plan asked for a test whose fixture cannot exist

**What happened.** Increment 2 named `a_dissolving_row_in_a_hex_with_no_own_unit_names_nobody`,
asserting `dissolves_into == None`, and told me how to build the report: the
`a_dissolved_units_take_is_not_handed_on` shape with `Receiver (900)` removed. That fixture always
yields `Some("Former (902)")`. `dissolve_empty_forms`' recipient search is
`position(|unit| unit.unit.region_id == region_id && unit.original.is_some())`, and a formed unit
always sits in the region of the reported unit that formed it — so the search cannot fail, and the
`None` arm is unreachable defensive code. I also tried the plan's own suggested escape (a nested
`FORM 1` / `FORM 2`), which names `Former (902)` too.
**Why.** The plan reasoned about the predicate one clause at a time — it correctly noted that the
recipient can never be the dissolving row itself (`formed_unit` mints `original: None`) — without
asking whether *any* reachable report leaves the region with no `original.is_some()` unit in it.
**Cost.** About ten minutes: two fixtures written, run and discarded, plus the deviation write-up.
**Prevent by.** `plan-bead`'s *Increments* section already asks for a named failing test per
increment; where that test's assertion is that a branch is taken, the plan should say which existing
test or which run proved the branch reachable — the same standard `implement-bead`'s "a helper the
plan cites for what it decides is read before it is built on" already applies to helpers, extended to
fixtures. The `None` sentence was covered at the tooltip level instead, which is where a plan can
always reach an unreachable core branch.
**Seen before.** None found for this shape.

## A third sighting: the smoke port block was taken by another session mid-bead

**What happened.** `SMOKE_PORT_BASE=4183` was free when I claimed it and `4184` was in use by the
time I re-ran the smoke suite after the review, with
`Error: http://127.0.0.1:4184 is already used`. `4193` had gone the same way. `4203` was free.
**Why.** There is no registry, as `implement-bead` says: the check is the whole mechanism, and it is
a check at one instant. Two implementers running the browser suites at different times in their beads
will collide whenever the second one's check happens between the first's runs.
**Cost.** About a minute, and one retry loop.
**Prevent by.** Nothing new — recording it because this is the third sighting, which is the evidence
the fleet produces that a mechanism wants fixing rather than tolerating. A `lsof`-guarded loop over
successive blocks (what I ended up writing inline) would belong in a script beside
`project-conf port_base` rather than in each implementer's shell.
**Seen before.** `ah-lbd9.4`, `ah-1mpx.3` — same error, same cause.
