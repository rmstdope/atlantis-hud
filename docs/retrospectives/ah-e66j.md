# ah-e66j — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-23
- **PR:** #606

## The plan's prescribed implementation broke the plan's own out-of-scope rule, and the plan's own test could not catch it

**What happened.** *Files to change* said to make `report_shortfalls`'s `pooled` closure true for
`SILVER` when the hex is maintenance-pooled, and added: "Everything downstream — the per-unit
suppression, the `claims` accumulation, the hex-level finding — is then the shipped code path,
unchanged." I implemented exactly that. The shipped `claims` accumulation collects *every* negative
silver balance of every non-sharer, order overdrafts included — so in any hex whose maintenance
step 4 could not cover, a unit that merely overspent on a `BUY` lost its per-unit finding, its
`unit_id` and its order line, and was merged into an anonymous hex-level one whose message implied a
faction-mate's silver was available to the purchase. The plan's *Out of scope* section forbids
precisely that: "`STUDY`, `BUY`, `GIVE` and produce inputs keep needing the `SHARE` flag."

The same section named `orders_are_not_shared_without_the_flag` (increment 6) as the test that
"exists to pin that" and specified its fixture. Written as specified, it passes either way: its
neighbour holds $5,000, so the maintenance pool never falls short, `maintenance_pooled` is never
set, and the regression is never reached. A second defect the plan half-anticipated was in the same
area — its *Known traps* warned that `upkeep_relieved` is "added to, never inserted into", but the
already-shipped `apply_relief` (step 7) used `insert`, which step 4 turned from a rare collision
into a routine one and which invented a shortfall in a hex that had paid for itself.

**Why.** Both were found only by the independent adversarial review in REFACTOR, which reproduced
each with a concrete fixture. Neither the plan's test plan, `pnpm run check:fast`, the 26-turn
corpus nor CI distinguished them: every one of those was green on the defective build.

**Cost.** About 40 minutes to re-derive a correct design (emit the maintenance finding from its own
block rather than pooling silver wholesale) and write the two regression tests. Nothing reached main.

**Prevent by.** Two things, both cheap:
1. When a plan prescribes reusing an existing code path "unchanged", read what that path actually
   does with the new input before writing the line — here, that `claims` is fed by every negative
   balance and not only by maintenance. A plan's confidence about shipped code is a claim, not a
   fact.
2. When a plan names a test as the guard for a rule, mutation-check *that* test against the rule
   before trusting it: break the rule deliberately and confirm the named test goes red. The
   `test-driven-development` skill already requires this of new tests that pass on first run;
   applying it to a plan-specified guard would have exposed this one in a minute.

**Seen before.** None found for this specific shape — `grep -rl "out of scope\|pooled"
docs/retrospectives/` turns up nothing describing a plan's prescription contradicting its own scope.

## `prepare-worktree` reported a successful install and left no `node_modules`

**What happened.** `.claude/cerebro/scripts/prepare-worktree` printed a full pnpm dependency list
ending "Done in 2.5s" and returned the worktree path. The first JavaScript command in that worktree,
`pnpm exec vitest run packages/shared/src/unitTooltip.test.ts`, failed with `Command "vitest" not
found`; `ls -d node_modules` in the worktree gave "No such file or directory". Running `pnpm install`
by hand in the same directory printed the same list, "Done in 2.4s", and left a working
`node_modules`.

**Why.** Not established. The two runs are indistinguishable from their output, so I have no
evidence for which of them behaved differently or why.

**Cost.** About five minutes, and a misleading first symptom: `vitest not found` reads as a missing
dev dependency or a wrong script name rather than as an install that did not land.

**Prevent by.** Have `prepare-worktree` assert its own postcondition — after the declared `install`
step, check that the tree now has whatever that install was supposed to produce (`node_modules` for
a pnpm project) and fail loudly naming the install command if it does not. A script that reports
success for work that did not happen is worse than one that fails.

**Seen before.** `prepare-worktree` appears in several retrospectives (`ah-y3j1`, `ah-ziv`,
`ah-11lh`, `ah-90gu`, `ah-0fa`) but `grep -rn "node_modules" docs/retrospectives/*.md` finds none
describing a silently missing install.
