# ah-eoag — retrospective

## The test helper for a sharer's silver clamps at zero, so it cannot see a coin counted too few times

**What happened.** The first coin-counting tests read each unit's silver at TRANSPORT through the existing helper `silver_stock_at_transport` (semantics.rs test module). That helper reads `SharerStock::own_for`. Mutating the code so a refused study's fee was never handed back left the STUDY test green: the student read `-10`, and the helper showed it as `0`.

**Why.** For a unit that does not lend, `SharerStock::own_for` returns `position(x).max(0)`. That suits a drain, but it hides an undercount. The helper's name and doc comment say nothing about the clamp.

**Cost.** About ten minutes: a mutation that should have failed passed, and finding out why. Had the tests not been mutation-checked, the STUDY test would have shipped unable to catch the regression it was written for.

**Prevent by.** Giving `silver_stock_at_transport` (crates/core/src/orders/semantics.rs, test module) a doc line saying it clamps a non-lender at 0, or making it return raw positions. The new `held_at_transport` helper beside it reads `StockParty::position` unclamped. Also: mutation-check a characterisation test once against the code it pins before relying on it.

**Seen before.** No.

## A bead refactoring the same fold landed while this one was in review

**What happened.** While PR #1557 was in review, ah-2fn5 (#1552) merged. It changes how a GIVE's unfunded silver is read in the same `SharerStock::at`/`Lending::settle` code this bead refactors, and the PR went `CONFLICTING`. ah-2fn5 changed the very term being removed: the fold now adds the GIVE's unfunded part to its own positions, and `SharerStock::at` nets only the cast's part. So the conflict had to be resolved by re-deriving the owner table against the new semantics, not by picking a side.

**Why.** Forge filed this refactoring from the sweep of `46c68955..83d52ed5`. ah-2fn5 was open against the same code at the same time, and neither bead named the other.

**Cost.** About twenty minutes: re-deriving the owner table on main, amending the plan, a second gate run, and a follow-up review of the whole diff.

**Prevent by.** A check when a refactoring bead is planned (`produce-bead` step 2, or Forge's filing) that lists the open and in-progress beads naming the same functions (`bd search` on the `Where` section's symbols), so a dependency edge orders them.

**Seen before.** ah-0ial (a concurrent merge broke a new test's call site), in a different area of the code.

## Main stopped compiling its tests: two PRs, each green alone, merged one after the other

**What happened.** This bead's docs-only retrospective commit went red in `rust` (clippy). The cause was on main, not in the PR: #1555 (ah-nd0e) gave the test helper `silver_shipped` an `orders` argument, and #1559 (ah-479u) then merged four calls without it. Both were green on their own heads. Every open PR touching the crate goes red until someone fixes main. This one fixed the four call sites itself.

**Why.** `main` has no branch protection (`branches/main/protection` answers 404), so nothing requires a PR to be up to date with main before it merges. Two PRs that each pass alone can merge into a main that does not build.

**Cost.** About fifteen minutes: reading the failure, a rebase, the fix, a gate run and a CI cycle. It also spent one of this bead's three fix attempts on someone else's break.

**Prevent by.** Requiring branches to be up to date before merging (`required_status_checks.strict`, or a merge queue) on `main`. Alternatively, a step in `produce-bead`'s *Merging* that runs the fast gate on the PR merged with the latest `origin/main` immediately before `gh pr merge`.

**Seen before.** ah-0ial ("a signature change broke a concurrent PR's call sites", same mechanism).
