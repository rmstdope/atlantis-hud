# ah-lyg6.4.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-05
- **PR:** #980

## A plan that names an existing helper as "the shape to copy" inherits its latent bugs

**What happened.** The plan specified `stripLongOrderLines` as a copy of `stripMovementOrderLines`
with the `.trim()` removed, and named the eleven month-long orders it must strip. I built exactly
that, with the tests the plan listed, and it passed the fast gate. The review sub-agent's first
cold read found that both functions are line-based and blind to nesting, so writing a mage's
`STUDY` silently deleted any month-long order inside a `FORM … END` or `TURN … ENDTURN` block in
his own orders — the new unit's `STUDY COMBAT` from `rules/form`'s own worked example, or a queued
`MOVE` from `rules/turn`'s — while the confirmation the same bead added told the player "Nothing
else in the document is touched". `longOrderOf` had the same blindness through `commandsOnly`, so
the prompt row named the nested order as the one being replaced and then failed to count it.

**Why.** The plan derived the new function from an existing one rather than from the rules, and
`stripMovementOrderLines` was written for a caller that rewrites the whole block, where nesting
never came up. Neither the plan's *Known traps* nor mine looked up `rules/form` or `rules/turn`,
because nothing in the increment mentioned either — the fact that a unit's block can contain
another unit's orders is not visible from the eleven-command list the plan did quote.

**Cost.** One review round and one fix commit, about fifteen minutes. It would have cost a player
their apprentice's orders, silently, recoverable only by the single in-visit Undo.

**Prevent by.** When a plan says "copy the shape of X", read X's *callers* as well as X: its
contract is only as wide as the one caller it was written for. And for anything that deletes or
rewrites lines of an orders document, look up the rules for the constructs that nest — `rules/form`
and `rules/turn` — before writing the first test, not only the rule that names the orders being
matched. `stripMovementOrderLines` still has this bug and is untouched by this PR.

**Seen before.** None found: `grep -rl "stripMovementOrderLines\|nesting" docs/retrospectives/`
returns only ah-z73s.3 and ah-oq3, both about line-based *git merges*, an unrelated sense.
