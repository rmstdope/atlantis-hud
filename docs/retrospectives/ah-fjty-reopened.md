# ah-fjty — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** #633

## A new finding shipped correct and invisible, because the plan named every surface but one

**What happened.** The bead was reopened by a failed verification reading "the new warning does not
fire at all". It fired. Run over the whole committed fixture corpus, `upkeep-exceeds-unclaimed`
produced ten findings on `G3_F42_T41` and nineteen on `G3_F42_T42`, each with a `unit_id`, a
`region_id` and the planned message, and the region and orders panels showed them. What did not
show it was the Silver column: `silverWarnings` in `AppShell.tsx` was keyed to `not-enough-silver`
alone, so the marked-up rows the navigator was reading carried a plain figure and no ⚠.

The plan was unusually thorough about surfaces — it specified the finding, the hover note, the
column figure, the settings row and the generated TypeScript, each with its verbatim string. The
unit table's ⚠ is a *sixth* surface, it is keyed by code rather than by anything generic, and no
section of the plan mentioned it. Nothing in the build could have caught that: every test the plan
asked for passed, and still passes.

**Why.** Established. The ⚠ set is a per-code allowlist rather than a derived property of a
finding, so every new unit-anchored code is invisible on the row until someone adds it by hand.
`not-enough-silver` was the only member, which made the omission look like the default rather than
a decision.

**Cost.** A failed verification, a planner audit that ruled out four candidate causes without
finding this one, a reopened P0, and a second full implementation session — of which about half an
hour was spent proving the core was innocent before the surface was even suspected.

**Prevent by.** Two concrete things, both the navigator's to decide:

1. `plan-bead`'s surface inventory should treat *the unit table's ⚠* as a named surface alongside
   the column figure and the hover, for any bead adding a unit-anchored finding code. The plan here
   listed five surfaces and would have been complete with six.
2. The allowlist is the underlying cost. `unitsWarnedAboutSilver` (this PR) is still a per-code
   list, only now a tested and named one; a code's *category* on the Rust side would let the table
   derive its markers instead. That is a refactoring bead, not a change to make inside a planned
   one — worth Bishop's attention.

Worth stating for whoever verifies next: a check that is silent on 24 of 26 committed fixtures is
silent for a good reason. Steps 4–6 (`ah-e66j`, `ah-eacd`) landed after this bead was planned and
pay the shortfall off before step 7 ever sees it, so an inactive fund is now the common case. A
verification of a last-resort rule needs a fixture chosen to trigger it, or it measures nothing.

**Seen before.** None found. `ah-j1xd` is the nearest — two surfaces disagreeing — but that is a
divergence between surfaces that both spoke, not a surface that stayed silent.
