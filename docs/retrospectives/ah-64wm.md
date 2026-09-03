# ah-64wm — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-04
- **PR:** #881

## CI scheduled no run for four consecutive pushes, and only a merge from main restarted it

**What happened.** The branch was opened on 2026-09-02. Its last workflow run was on head `f00c9aa`;
the four pushes after it (`66613aa`, `f704b1e`, `1bf70cf`, `8262ccb`) produced no run at all -
`gh pr checks 881` answered "no checks reported on the branch". Two earlier passes on this bead
waited for checks that were never going to arrive, escalated, and handed it back. The branch was by
then 8 ahead / 18 behind main and conflicting. Merging `origin/main` into it and pushing scheduled a
full run within seconds, and every push after that scheduled one too.
**Why.** Not established. The correlation is with the branch being `CONFLICTING` against main:
GitHub declined to schedule for a head it could not merge, and said so nowhere the PR shows. I did
not prove that is the cause.
**Cost.** Two implementer passes ended without merging, plus about forty minutes of check-polling
across them.
**Prevent by.** `implement-bead`'s *Merging* section already has a merge-state check, but it is
placed after a push that "could have raced main" and is written as a guard before a CI wait.
"No checks reported at all after a push" should send an implementer to that same check first -
`gh pr view --json mergeable,mergeStateStatus` - rather than into a twenty-minute wait and an
escalation, because a `CONFLICTING` head appears to explain a silent CI.
**Seen before.** None found in `docs/retrospectives/`.

## A long-lived branch met a refactor of the very function it was changing

**What happened.** While this bead sat, `ah-d0ku` merged and restructured `apply_transports` into
the three phases of `rules/sequenceofevents`. This branch had added a target-eligibility gate to the
single-pass version of the same function. Nine conflict hunks in `crates/core/src/orders/effects.rs`,
and the resolution was not mechanical: the gate had to move inside the per-phase loop, the per-order
index the interface interleaves lines by had to be lifted out of phase order into a document-ordered
map, and two of `ah-d0ku`'s own regression tests asserted deliveries that `rules/transport` forbids
once the gate exists - one was rewritten, one deleted as no longer representable.
**Why.** Two beads were planned against the same function without a dependency edge between them,
and this one then waited two days on the CI fault above.
**Cost.** About an hour of resolution and two extra review rounds.
**Prevent by.** When planning two beads that both name the same function in their design, wire the
ordering with `bd dep add` so the second is planned against the first's merged shape - `plan-bead`'s
scoping step is where that belongs.
**Seen before.** None found for this pair of beads.
