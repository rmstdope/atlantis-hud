# ah-1ad6.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #632

## The plan's verbatim message quoted a number its own later decision made wrong

**What happened.** The plan gave the advisory's wording as verbatim and not to be varied:

    cannot pillage here: needs 90 combat ready men, this faction has 1

The `1` is the observed unit's *headcount* — one leader — and it was written during round 1 of the
interview. Round 2 of the same interview then settled that a man is combat ready only when he has a
weapon he can wield, and that an `avoiding` unit has none. The observed unit,
*The Lost One (683)*, is `avoiding` and holds no weapon, so the rule the plan settled produces
`this faction has 0` and the sentence the plan quoted cannot be printed by it. I hit it as a failing
assertion I had copied straight out of the plan.

**Why.** The two figures come from different rounds of one interview, and nothing re-derived round
1's sample sentence after round 2 changed the rule that computes its numbers. The plan's *Known
traps* section correctly warned about far subtler things (`DBOW` needing `LBOW`, a `None` poisoning
the hex) while carrying this contradiction in its most emphatic instruction.

**Cost.** About five minutes, and one moment of judging whether a verbatim user-facing string that
cannot be produced was a decision to hand the bead back over. It was not — the message's *shape* was
what the navigator chose, and the number is whatever the settled rule computes — but that call is
one an implementer should not have to make, since getting it wrong in the cautious direction costs
the bead a round trip through the `human` queue.

**Prevent by.** In `plan-bead`, when an interview runs to more than one round, re-derive every sample
figure in the plan against the rule as it finally stands before writing the plan out — the sample
sentences are the part of a plan most likely to have been drafted before the decision that governs
them. A cheaper version of the same check: a plan that quotes a message verbatim should show the
arithmetic that produces each number in it, next to the sentence, so a stale figure is visible
rather than authoritative.

**Seen before.** `ah-wbr9` — the same class exactly: five "verbatim" messages, one of which no
implementation could produce because a rule stated elsewhere in the same plan contradicted it. That
one cost a deviation flagged in a PR body for the navigator to overrule. This is the second sighting.
