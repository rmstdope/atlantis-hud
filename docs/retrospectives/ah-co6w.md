# ah-co6w — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-12
- **PR:** #1202

## The plan's *Decided by me* contradicted the navigator's agreed record, and only the review caught it

**What happened.** The bead's `design` and its `acceptance_criteria` gave opposite answers for one
player-visible state. The record's state list says "**One item aboard of unknown weight** — treated as
load unknown, even when every other item is known. A partial total is not a total", and its
rejected-options section rejects refusing an unknown load outright. The plan's *Decided by me* then
specified the opposite — `fleet_load` falls back to the server's stated `Load: H/N` first number when
a unit aboard cannot be weighed, which makes the load *known* and refuses the fleet in red. Both
documents are load-bearing and the plan quoted the record approvingly two sections earlier, so
building the plan faithfully produced a panel that contradicts what the navigator signed off. I did
not notice while building; the review sub-agent's first finding did, and named it as the navigator's
call rather than ruling on it. The navigator chose the plan's reading.

**Why.** The two fields are written at different stages — `agree-experience` fills `acceptance`,
`design-the-build` fills `design` — and nothing compares them. A build-design session that decides a
mechanism can reach a state the UX session already settled, without either noticing the collision.

**Cost.** One review round and a question to the navigator, about twenty minutes. No rework, because
the answer happened to favour what was built; had it gone the other way it would have been a code
change, a re-gate and a second CI cycle.

**Prevent by.** `implement-bead`'s *When the plan is wrong* already asks an implementer to check a
cited *helper* before building on it. The same check is worth asking for the two documents: before the
first increment, read the record's state list against the plan's *Decided by me* and treat a
disagreement about a state the player can reach as a question, not a detail. It is cheap — both are
already read at the top of the bead — and it moves the catch from the review round to the first five
minutes.

**Seen before.** `docs/retrospectives/ah-gfzu.md` — the plan's acceptance criteria contradicting its
own behaviour table; `docs/retrospectives/ah-qled.8.md` — an acceptance criterion no work in the bead
could satisfy. Same family, third sighting: the acceptance record and the plan drifting apart.
