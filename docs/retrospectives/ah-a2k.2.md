# ah-a2k.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #393

## The committed corpus contradicted the plan, and only the gate said so

**What happened.** Every unit test the plan named was green, and the check was complete, before
`pnpm run check:fast` failed three tests in `crates/core/tests/validate_real_orders.rs`. The new
check fires six times on the committed turn-71 fixture — the Borg mages studying force and pattern
at levels 3–4 aboard `Princess of the Dawn [1239] : Cloudship` — and that turn's own *Errors during
turn* section carries no halving advisory for any of them, while the units the engine *did* warn in
`neworigins-3.0.0-g7-f62-t17.rep` stand in no structure at all. Read alone, that says a ship
shelters a mage, which is the opposite of the plan's `a_ship_is_not_a_building_that_houses_mages`
and of the bead's acceptance criterion. It took two questions to the navigator and a reading of
`tests/fixtures/ruleset/neworigins-rules.html` ("It is possible that there are advanced buildings
not listed here which also can support mages") to settle that the plan was right after all and the
six findings are real.

**Why.** The plan's *Known traps* did anticipate the smoke fixture's problem count and told me to
check it before opening the PR. It did not anticipate `validate_real_orders.rs`, which is the
stricter bar of the two: it asserts the committed turn is *silent* except for a named list, so any
new check that fires on real data breaks it. The plan reasoned about the fixture the check would be
demonstrated on and not about the fixture that exists to prove no check invents findings.

**Cost.** About 40 minutes and two navigator questions, before the first push. No CI cycle — the
gate caught it, which is the good version of this. The corpus and smoke expectations then moved
together in one commit.

**Prevent by.** A plan for a **new advisory code** should carry, in its *Known traps*, the same
instruction for `crates/core/tests/validate_real_orders.rs` that this one carried for the smoke
specs: run it early and decide deliberately whether the committed turn should now carry findings.
Better still, that check belongs before the increments rather than in the traps — for a check that
reads real report state, "what does this say about the one turn we have ground truth for?" is
evidence about whether the *rule* is right, not merely about a fixture that needs updating. Here it
was very nearly read as the rule being wrong.

**Seen before.** ah-bqi ("The plan's own validation grep contradicted the prose the plan asked
for") is the same shape one layer down — the plan's own stated check disagreeing with the plan's
intent. Nothing found on the corpus fixture specifically.
