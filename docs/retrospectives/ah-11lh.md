# ah-11lh — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-20
- **PR:** #459

## `prepare-worktree` cannot make a tree for a bead that already has a branch and an open PR

**What happened.** This bead came back to the queue with its work already built, reviewed and pushed
on `ah-11lh-per-code-expectation-table` (PR #459), needing only to be caught up on main. The
`implement-bead` skill's *Workspace* step is the only documented way to make a tree, and
`prepare-worktree --path … --branch ah-11lh-per-code-expectation-table` aborted with
`fatal: a branch named 'ah-11lh-per-code-expectation-table' already exists`. It always creates a new
branch; there is no flag for checking out an existing one. I fell back to a bare
`git worktree add .cerebro/worktrees/ah-11lh <branch>`, which skips both the submodule init and the
`pnpm install` that the script exists to guarantee — I ran both by hand afterwards, having noticed;
a session that did not would have hit an `agent-state` or a `lint` failure with nothing to connect
it to the cause.
**Why.** Established. `prepare-worktree` is written for the common case — a fresh bead, a new
branch. A bead returned to the queue with an existing PR (this one, and `ah-bet5` in the same batch)
is a case the script and the skill's *Workspace* section do not cover.
**Cost.** About ten minutes, and a silently degraded worktree that only care avoided.
**Prevent by.** Either give `prepare-worktree` an existing-branch mode (check out rather than
branch, same submodule init and install), or add a sentence to `implement-bead`'s *Workspace*
section naming what to run when the bead's branch already exists — and say that the submodule init
and `pnpm install --frozen-lockfile` must then be run by hand.
**Seen before.** None found.

## The rebase conflict was the exact hazard this bead was filed to remove

**What happened.** Rebasing onto main produced one conflict in
`crates/core/src/orders/semantics.rs`: main had appended a `BUILD_WITHOUT_SKILL` case to
`every_advisory_code_can_be_silenced`'s vector in the old four-tuple form while this branch was
converting the whole vector to named-field structs. Resolved by re-expressing main's new case as a
`Case { … }`.
**Why.** Established, and worth recording as evidence rather than as a problem: `ah-oq3` filed this
class after git auto-merged two tuple appends into a **valid but wrong** case with no conflict
marker. Here the same collision produced a real conflict, because the two sides overlapped
textually — so this is a near-miss of the ah-oq3 failure, on the very bead that fixes it, and after
this change the interleaving ah-oq3 describes is a compile error.
**Cost.** Five minutes, one manual resolution.
**Prevent by.** Nothing further — the struct conversion merged here is the prevention. Recorded so
the ah-oq3 hazard has a dated second sighting and a resolution.
**Seen before.** ah-oq3 — same vector, same class, silent instead of conflicting.
