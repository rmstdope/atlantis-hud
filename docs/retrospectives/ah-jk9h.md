# ah-jk9h — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-25
- **PR:** #682

## The plan's "is this a vessel" test was `parse_fleet_kind`, which answers a different question

**What happened.** The plan gave `sails_away` in full, using
`parse_fleet_kind(&fleet.kind).is_some()` to decide whether a structure is a vessel. Written exactly
as given, the plan's own trap test — `a unit aboard an ordinary building is still told` — failed:
no `produce-not-here` finding for a fisherman standing in a `Fort`. `parse_fleet_kind`
(`movement/mode.rs:191`) reads **any** non-empty kind as a one-hull fleet and returns `Some`; it
parses a kind that is already known to be a fleet, it does not classify one. Replaced with
`sailing_requirement(fleet, Some(ruleset)).is_some()`, which only a structure with `Sailors: H/N`
or a ruleset-known hull answers.

**Why.** The plan reasoned from `check_sailing`'s use of `parse_fleet_kind` as a filter. It works
there only because `check_sailing` also requires a captain with a `SAIL` order, so a fort never
survives the rest of the loop — the looseness is invisible at that call site and load-bearing at
this one.

**Cost.** About fifteen minutes: one failing test, a wrong-turn debug pass adding a nested `check`
call to the assertion message, then reading `parse_fleet_kind`'s body.

**Prevent by.** A plan that hands the implementer a helper as a predicate should state the helper's
**failing** case, not only its passing one — "`parse_fleet_kind` returns `None` for X". Where it
cannot, the plan's trap test is what catches it, and this plan's did: the trap section is worth
writing even when the code block above it looks complete.

**Seen before.** `docs/retrospectives/ah-048.md` — *"The plan's 'is a fleet' test was not one, and
its own trap is what proved it."* Same helper, same mistake, same rescue. Third-party evidence that
`parse_fleet_kind`'s name reads as a classifier to every reader who has not opened it; the durable
fix is probably to the helper's name or its doc comment, which is the navigator's call and not a
planned bead's.
