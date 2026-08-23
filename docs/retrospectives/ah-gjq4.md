# ah-gjq4 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #631

## A shipped message's wording depended on a figure the bead's change made wrong, and only the smoke suite said so

**What happened.** The plan named `late_income`, `pool_wants`, the estimated-headcount gate, the
`UnitSilver` field and the hover, and every Rust and TypeScript suite went green locally on all of
them. CI's `smoke (web, 2, 2)` and `smoke (desktop-shell, 2, 2)` then failed on
`tests/smoke/workspace.spec.ts:925`, which asserts a hex shortfall says *"their orders spend"* and
not *"upkeep"*. The wording comes from `spenders(unpaid_upkeep(...))`, and `unpaid_upkeep` is the
**whole fee** less what an earlier payment step relieved — it does not subtract what the unit's own
wages paid. Before this bead, unit 18642 was idle and earned nothing, so the fund paid its whole
$50 and the figure was zero; after it, wages paid $24 and the fund $26, so the figure was $24 and
the message named an upkeep that had spent none of the unit's silver.

**Why.** Established. `Ledger.upkeep` deliberately keeps the full fee, documented as *"read only to
word the finding"*, while `upkeep_drawn` holds what maintenance actually took off the balance. The
step-7 claim helper already used `drawn - relieved`; the wording used `fee - relieved`. The two
disagreed for any unit whose wages part-paid its fee — a corner case while only an explicit `WORK`
earned wages, and the common case the moment idle units did.

**Cost.** One full CI cycle (~13 minutes) plus about twenty minutes of diagnosis, most of it spent
guessing before writing a throwaway Rust probe over the committed turn-71 fixture, which named the
cause in one run. Fixed by adding `upkeep_still_drawn` for the wording and leaving `unpaid_upkeep`
to the classification question it answers.

**Prevent by.** When a bead adds a new source of income or relief, the plan's *Files to change*
should include the **message wording** functions that read the same ledger fields — here
`semantics.rs`'s `spenders`/`unpaid_upkeep` — not only the arithmetic. A grep for the ledger field a
bead newly affects (`upkeep`, `upkeep_drawn`) would have found the wording site before the PR
opened. The mechanical lesson: when a browser suite fails on a message, reproduce it as a Rust test
against the committed fixture immediately rather than reasoning about the shell.

**Seen before.** None found — the retrospectives that mention the smoke suite are about build
artefacts and selectors, not about a message figure.
