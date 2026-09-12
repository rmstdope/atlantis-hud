# ah-3u7c.2.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-12
- **PR:** #1203

## The plan stated a shared reader's behaviour, and the reader does the opposite

**What happened.** The plan's *Files to change* section said of `OrderedUnits::steps_for`: it
"hands back the unit's `&[MoveStep]` with every chained `MOVE` already folded into one list, which
is what `rules/move` means by 'Multiple MOVE orders given by one unit will chain together'". It does
not. `crates/core/src/movement/fleet.rs:138` is `by_unit.insert(unit_id, steps.clone())`, so a
second `MOVE` line **replaces** the first:

```
$ # unit 5 standing in a Shaft, ordered "MOVE N" then "MOVE IN"
steps=Some([In])
```

I only found this because a review finding asked for a test of the `steps[..before]` guard and
suggested the shape `MOVE N` / `ENTER 1` / `MOVE IN`. That shape does not reach the guard either —
`ENTER` is a boarding order, not a `MoveStep` — and writing the test is what made me print the
folded steps and see the `MOVE N` gone. The reachable shape is one route, `MOVE N 1 IN`.

The consequence for this bead is a false claim: `MOVE N` / `MOVE IN` yields a crossing claimed from
the hex the unit has already left, and the next turn's report would write that unit's real
destination down as the far side of a shaft it never entered. It is a live defect in the existing
trace and preview too, so fixing `fleet.rs` was out of this bead's scope; it is filed as `ah-vmxn`.

**Why.** Established for the mechanism (`insert`, not `append` or `extend`), not for the intent —
nothing in `fleet.rs` says whether last-line-wins was a decision or an oversight, and no test pins
either way. The plan's sentence reads like a summary of the doc comment on `steps_for`, which says
only "The unit's own movement steps, if it wrote any."

**Cost.** About twenty minutes: one test written against a shape that could not fail, a debug probe
to find out why, and the rewrite. Small here only because a reviewer happened to ask for that test.
Had nobody asked, the guard would have shipped untested and the false-claim path unnoticed.

**Prevent by.** `implement-bead`'s *When the plan is wrong* already says a helper the plan cites
**for what it decides** is read before it is built on. This case is one step further out: the plan
cited `steps_for` for what it *returns*, not for a decision, and I read its signature and doc
comment rather than the line that fills it. The rule would have caught this if it named a behavioural
claim about a helper's output — "already folded", "always sorted", "never empty" — as the same kind
of claim as a predicate's acceptance, and asked for the same read of the body. That is the
navigator's to decide, not mine to change.

**Seen before.** `ah-sdw5` — "A refactoring plan asserted the old and new queries were equivalent,
and two of six were not": the same shape, a plan stating what existing code does rather than what
the bead should do. Also `ah-19l2.2`, `ah-728m.3` and `ah-cg1` carry findings of that class.
