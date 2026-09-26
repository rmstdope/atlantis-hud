# ah-haki — retrospective

- **Role:** verifier
- **Date:** 2026-09-26
- **PR:** #1315 (the bead's delivery; this file is the verifier's)

## The verification script's decisive step did not reach the case, and no verdict could be taken

**What happened.** Psylocke verified ah-haki together with ah-5znb, at origin/main d8a191a0, on a
made fixture: `newage-arcanum-f3-t84.rep` played under the Arcanum ruleset, with Unit (630)'s
livestock overwritten as stone so that its 31 grain was the only food in swamp (7,25). The decisive
step had the navigator give 630 `TRANSPORT 667 ALL GRAI EXCEPT 2`, then check that Unit (502), set to
consume faction food, was still shown as paid by faction food. The navigator found that 502 works
for wages and is given 400 silver by another unit in the forecast. On that basis they judged that it
never needed the transported grain, so the step could not tell a fixed build from a broken one. The
verdict was withdrawn and the bead left `verification:pending`.

**Why.** The fixture probe asserted only parsing and classification: men, items, unreadable lines
and unknown tags. It never ran the forecast against the orders the script used, so nothing checked
before the sitting that the consumer's upkeep actually depended on the grain. The script's
expectation came from `rules/economy_maintenance` (a unit set to CONSUME FACTION eats faction food
before its own silver). Whether the application's forecast agrees with that order when the unit also
has silver and wages was not established.

**Cost.** One of two beads in a roughly ten-minute navigator sitting produced no verdict, and
ah-haki goes round again on a later pass.

**Prevent by.** In `.claude/skills/atlantis-verification/SKILL.md`, *The fixture: pick one, prove
it*: for a bead about the forecast, the probe must also run the forecast (`review_turn`) with the
script's orders, with and without the order under test. It must show that the decisive figure
changes between the two, before the navigator is asked. A case where the figure is the same with and
without the order cannot fail, and is not a check.

**Seen before.** None found.
