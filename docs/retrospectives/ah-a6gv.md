# ah-a6gv — retrospective

- **Implementer:** Rogue
- **Date:** 2026-10-14
- **PR:** #1586

## The pinning test ah-ayg7's retrospective prescribed could not tell the two settlements apart

**What happened.** ah-ayg7's *Prevent by* asked for a test that pins one SILVER column figure and one warning sentence "in a hex where nobody can pay the rest", and this bead's acceptance repeats it. The plan picked the hex of `a_refused_student_with_no_faction_mate_to_pay_keeps_the_hexs_warning`. On main, I handed `forecast_hex` the warning's settlement in one mutation, and the checks the column's in another. That hex stayed green under both. A second hex, with a partly paying faction-mate, caught only the checks' mutation. Only a hex where the refused student's handed-back silver is *lent* at step 4 to a starving faction-mate failed both. Two men refused COMB's $20 with $15 is that hex.

**Why.** Where nobody can pay, steps 4 to 7 relieve nothing on either surface, so `UpkeepRelief` is identical in both settlements. The two surfaces then differ only in what step 3 and the sentence wording read, and neither mutation reaches those. The column reads the ledger's relief only through `silver_at` at MonthEnd, which feeds `shared_silver_coverage`. So the column side is pinned only when the relief flips a unit's month-end sign.

**Cost.** About twenty minutes of probe runs before the first real commit. Without the mutation check the plan's hex would have shipped as a test that guards nothing.

**Prevent by.** In a bead's acceptance or plan, name the property a pinning test needs ("the two settlements differ in `UpkeepRelief`", e.g. a hand-back lent at step 4), not a fixture shape. Mutation-check it against main before the refactor starts, as `produce-bead` step 3's first increment does here.

**Seen before.** `docs/retrospectives/ah-sefq.md` (running the mutation on any test a plan names as the guard for a specific mistake).
