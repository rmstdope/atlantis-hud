# ah-rzkm — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-03
- **PR:** #902

## The plan's own rule citation was backwards, and building on it made the bug worse

**What happened.** The plan's *Known traps* said: *"Normalize only after `apply_transfers` in
`hex_with_transfers` … BUY must not affect the decision; `rules/sequenceofevents` places TEACH
before the market phase."* It is the other way round. `pnpm run atlantis rules sequenceofevents`
puts **Market orders** (SELL, BUY, FORGET, WITHDRAW, SACRIFICE) before **Movement orders** and then
**Month long orders** (TEACH, STUDY, PRODUCE, BUILD, ENTERTAIN, WORK), so a unit teaches with the
men it just bought. I implemented the plan's position, and the first review round then found that
the month filter and `check_teacher` read `teaching_eligibility` on opposite sides of
`apply_recruits`. My fix for that finding *quoted the plan's wrong rule back* and unified them on
the pre-recruit side, which turned a divergence into a visible contradiction: the unit was told
`teacher-cannot-teach` and `two-month-long-orders` about the same TEACH. The second review round
caught it and looked the rule up.

**Why.** `implement-bead` requires a *helper* the plan cites and a *current-source* claim the plan
relies on to be checked before the increment that depends on them. It does not say the same about
an **Atlantis rule** the plan cites — and the root `CLAUDE.md` rule ("ALWAYS look a rule up rather
than recalling it") reads as being about writing a new statement, not about a statement already
written down in a plan I was handed. So I treated the citation as settled.

**Cost.** Two extra review rounds and two CI cycles, roughly forty minutes, plus a commit that had
to be reversed in the one that followed it.

**Prevent by.** Adding an Atlantis rule citation to `implement-bead`'s *When the plan is wrong*,
beside the helper and current-source rules: a plan sentence of the form "`rules/x` says …" that a
design decision hangs on is looked up with the `atlantis-rules` skill before the increment that
depends on it, and a plan that has it wrong is a plan wrong about approach. One `pnpm run atlantis`
call would have cost thirty seconds here.

**Seen before.** None found — `grep -rl "sequenceofevents" docs/retrospectives/` was empty.
