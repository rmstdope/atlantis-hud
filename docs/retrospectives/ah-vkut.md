# ah-vkut — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-18
- **PR:** #429

## The disk preflight now fails with nothing left to reclaim

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` reported 5.6 GB free against its 8 GB
floor and exited non-zero. `.claude/cerebro/scripts/prune-worktrees.sh` freed nothing: every
worktree it found was either holding unmerged work (`ah-v09e-mockup`), Psylocke's verification tree,
or mine. The only large reclaimable item on the whole disk was
`.cerebro/worktrees/psylocke/target` at 2.3 GB — which would have reached ~7.9 GB, still under the
floor. The bead was blocked before a line of it was read, and I had to put it to the navigator, who
chose "proceed anyway". The build then completed without incident.

**Why.** The machine is at 98% (191 GiB used of 228 GiB), and almost none of that is the fleet's:
the two build trees the preflight names total 2.2 GB. Whatever is filling the disk is outside
anything an implementer or `prune-worktrees.sh` can see.

**Cost.** About ten minutes, one round-trip to the navigator, and — had they been asleep — a bead
handed back for a reason that has nothing to do with the bead.

**Prevent by.** This is a machine-level problem, not a bead-level one, and it is now the *fifteenth*
retrospective to name the disk (see below), which is the point: no implementer can fix it, so it
keeps costing one round-trip per bead until somebody frees space outside the repository. The
actionable piece for the fleet is smaller: `prune-worktrees.sh` should say *how much it could not
reclaim and why*, so a session can tell "there is nothing to prune" from "there is 2.3 GB here I am
not allowed to touch" without running `du` by hand. Second, the preflight's 8 GB floor is a single
number for every bead — a Rust-plus-TS change like this one built fine at 5.6 GB, so if the floor is
sized for the worst case it might usefully report both "the floor" and "what this actually needs".
Both are the navigator's calls, not mine.

**Seen before.** ah-9r0, ah-l2i.1, ah-l2i.2, ah-l2i.3, ah-vfq, ah-9lv, ah-58n.1, ah-8m0.2, ah-j0e,
ah-1znc, ah-do8.2, ah-do8.3, ah-quw, ah-s0m — fourteen files already mention the disk.

## A new advisory check fired on six fixtures written for other checks

**What happened.** With `check_building_outside` and `check_build_help` in place and all eighteen
new tests passing, six unrelated tests failed: `a_build_order_is_not_a_produce`,
`a_builder_that_leaves_this_month_is_not_told_the_structure_is_finished`,
`a_helper_is_judged_on_where_the_helped_unit_ends_its_orders`,
`a_helper_is_warned_about_the_structure_it_would_work_on`,
`a_unit_building_is_not_offered_as_a_spare_teacher` and `a_unit_in_no_structure_is_silent`. Each
uses a bare `BUILD` from a unit standing in nothing, or a `BUILD HELP` naming a unit with no orders,
purely as filler to occupy a unit's month — so every one of them tripped a new check correctly.

**Why.** An advisory check that fires on a *common, incidental* order shape collides with every
fixture that used that shape as scenery. The plan was unusually thorough — it named the real-orders
corpus, the generated vocabulary, the hard-coded `titles` array in `SettingsDialog.test.tsx`, and
the `every_advisory_code_can_be_silenced` table — and still did not anticipate this, because the
collision is not with anything the new code touches. It is with fixtures that predate it.

**Cost.** Small: about fifteen minutes to read the six and decide the honest fix, which was to scope
each to its own check rather than change what it expects — five through a new
`check_ignoring_empty_builds` helper (the precedent being the existing
`check_ignoring_transfer_targets`), and `check_trade` by disabling the one code. Recording it
because the next new-advisory-check bead will hit it, and because the wrong fix — weakening the new
check until the old fixtures go quiet — is both available and hard to spot in review.

**Prevent by.** `plan-bead`'s *Known traps* for any bead adding an advisory check should carry one
more line: *run the full suite once the check exists and expect unrelated fixtures to trip it; scope
those fixtures to their own check (the `check_ignoring_*` pattern) rather than changing what they
expect or softening the new check.* The pattern already exists in `semantics.rs` and only needs
naming where a planner will see it.

**Seen before.** None found.
