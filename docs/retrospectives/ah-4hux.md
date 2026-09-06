# ah-4hux — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-06
- **PR:** #999

## The plan named a fixture unit the game will not let do what the plan asked of it

**What happened.** Increments 3, 4 and 6 were all written around unit 18642 "Seven of Eight",
which the plan named as the unit that writes `FORM 1` and then feeds the new unit with
`GIVE NEW 1 1 LEAD`. The formed unit dissolved on every run. `GIVE 18642 → anyone` moved nothing at
all, including a bare `GIVE 0 1 LEAD` discard, and the giver's row did not even appear in the
preview — a silent no-op with no `uncounted` entry and nothing in the response to point at. The
cause is `move_between`'s `mage_give_refused` guard: 18642 holds skill `MANI`, and `rules/magic`
forbids a mage to GIVE men at all. It is also the only own unit in that hex, so the fixture could
not be repaired in place; the tests moved to 15571 "Drones" at `1:18,44` (50 lizardmen, no magic
skill) and a lizardman as the gift.
**Why.** A plan can name a real unit from a real report without checking that the *specific order*
it is asked to write is one the game lets that unit write. Nothing in the plan's own validation
would have caught it: the orders are syntactically valid, the report shows the unit holding the
item, and the failure surfaces only as a formed unit that quietly dissolves.
**Cost.** About 25 minutes and six exploratory `cargo test` runs, spent probing GIVE variants and
printing parsed inventories before the guard was found by reading `move_between`.
**Prevent by.** `plan-bead`'s *Increments* section should say that a fixture unit named for an
order is checked against the rules that constrain **that order for that unit**, not only against
the report showing the unit and the item — a skill list is part of a unit's fixture profile, not
decoration. `rules/magic`'s "mages may not GIVE men at all" is the case here; a unit's flags and
faction declarations are the same kind of trap for `GIVE` and `TRANSPORT`.
**Seen before.** None found. `ah-cklr`, `ah-j2w` and `ah-titf` each record a fixture that was
*insufficient* — one guarding two checks, a unit list a rule read differently, a suite whose own
fixture collided. This is a different failure: a fixture the game actively refuses.

## The plan's cause list stopped one layer above where the speed actually comes from

**What happened.** With the status ladder rewritten and a formed unit correctly `Departing`, its
`departing_to` was still `None`. `refresh_movement` sets `WorkingUnit::unit.movement`, but
`trace_move` asks `movement::mode::mobility`, which reads the report's `Weight:` and `Capacity:`
*strings* and ignores `movement` entirely. A formed unit has neither string, so every settled formed
row traced as `Mobility::Unstated` — a path with no months, which is exactly "a departure to nowhere
nameable".
**Why.** The plan correctly said the trace needs the *settled* row "because the men and goods its
block is given are what give it a speed", and named `settle` as the way to get one. It did not check
that the field `settle` refreshes is the field the tracer reads. Two fields carry the same fact and
only one of them is derived.
**Cost.** About 15 minutes, and one deviation from the plan (a fallback in `mobility`) that had to
be argued in the PR body rather than being planned work.
**Prevent by.** The same rule this skill already states for helpers — *a helper the plan cites for
what it decides is read before it is built on* — applied to **fields**: where a plan says a value
must be refreshed so a reader can use it, open the reader and confirm which field it actually reads.
**Seen before.** None found.
