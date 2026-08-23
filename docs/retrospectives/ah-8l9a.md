# ah-8l9a — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #608

## The plan's reconstruction arithmetic was wrong, and only the corpus said so

**What happened.** The plan's *Files to change* gave the restored reconstruction as
`pool = Σ max(0, balance)` against `needed = Σ max(0, upkeep_before_hex_sharing − max(0, balance))`,
and called it "the load-bearing claim of this plan". It is not production's condition. It does not
reduce correctly even for a one-unit hex (it yields `2B < U` where the answer is `B < U`), and it
ignores two gates the ledger actually applies: `unpayable_upkeep` caps each claim at what
maintenance drew, and `report_shortfalls` emits the hex finding only for a unit whose *whole*
remaining overdraft is upkeep (`short <= unpaid_upkeep`). Written as given, the guard failed on real
hexes in three successive shapes before the arithmetic was rebuilt from `semantics.rs`.

**Why.** The plan reasoned about step 4 from `ah-e66j`'s plan text rather than from
`share_silver_for_upkeep` and `report_shortfalls` as shipped. Both gates are in the code and in
neither plan. The plan's *mechanism* — add `shared_silver_covered` back, add no production field —
was right and is what the merged test does; only its formula was wrong.

**Cost.** About 40 minutes and four failing runs of the corpus suite. No CI cycles: every divergence
surfaced locally, which is the one thing that went well.

**Prevent by.** When a plan states a reconstruction of production arithmetic as an explicit formula,
`plan-bead` should require it to cite the production function each term comes from, by name and
line. The three terms this plan got wrong are each one `grep` from a function it never names. A
formula with citations is checkable while planning; one without is only checkable by running it.

**Seen before.** `ah-2tj8` — "The plan's deliberate break proved nothing, because the corpus never
exercises it" — is the same family: a plan reasoning about the corpus and the ledger from its own
description of them rather than from what they contain. This is the second sighting.

## Undoing scripted instrumentation threw away two green increments

**What happened.** A `python3` edit located its target with `s.index(a)` and `s.index(b)`, and the
two indices matched a *different* pair of occurrences than intended — deleting everything between
them and truncating the 600-line test file to 138 lines. Nothing was committed at that point, so
increments 2 and 3 were gone and had to be reapplied from scratch.

**Why.** Two increments had been finished and left uncommitted because neither was "the whole bead".
Slice-by-index editing has no equivalent of Edit's uniqueness check, so a non-unique anchor deletes
silently rather than failing.

**Cost.** About 20 minutes reapplying work that was already green.

**Prevent by.** `implement-bead`'s *Building* section should say to commit at the end of each
increment, not once before the PR — the skill already frames increments as the unit of work, and a
commit per increment makes any undo, scripted or manual, cost one increment at most. Separately, a
scripted edit should assert its anchor is unique (`assert s.count(old) == 1`) before replacing;
the reapply script in this run did, and had no such failure.

**Seen before.** `ah-ycuj` — "`git checkout <file>` to undo instrumentation threw away three
increments" — is the same finding with a different instrument (git rather than a Python slice), and
`ah-bkjd` records a third variant ("Proving the ratchet bites, by reverting one line, cost the run's
uncommitted work"). **Third sighting**, and all three have the same cause: increments finished and
left uncommitted.
