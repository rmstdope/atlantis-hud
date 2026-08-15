# ah-sup — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-15
- **PR:** #243

## `pnpm run check`'s tooling suite fails on any live sibling worktree, not just my own

**What happened.** `pnpm run check` aborted at the tooling suite
(`scripts/cargoTargetDir.test.ts`, "keeps the worktrees inside the repository") with an unrelated
worktree listed as a stray: `git worktree list` on the shared repository showed another live
session's worktree sitting outside `.claude/worktrees/`
(`/private/tmp/.../scratchpad/pr-epic`). Lint and typecheck (both of which run earlier in the same
gate) were clean, and the failure had nothing to do with any file this bead touched. I ran the
remaining gate steps (`test:smoke`, `build:web`, `test:pwa`, `cargo fmt`, `cargo clippy`) by hand to
confirm the branch was otherwise green, and noted the pre-existing, unrelated failure in the PR
body per the TDD skill's guidance on distinguishing branch-introduced from pre-existing failures.
**Why.** The test enumerates every worktree the machine's git knows about (`git worktree list
--porcelain` from the repository root), not just the ones this session created — so any other
agent's or the navigator's own worktree living outside `.claude/worktrees/` at the moment the check
runs fails it for everyone sharing the machine, regardless of whose branch is under test.
**Cost.** About five minutes: one full `pnpm run check` run to discover the abort, then running the
remaining steps manually since the script stops at the first failure.
**Prevent by.** Nothing to change in this bead's own work — the finding is that `pnpm run check`
is not safe to run unmodified on a machine with other concurrent implementer/planner/navigator
sessions holding worktrees outside `.claude/worktrees/`, which is the normal state of this fleet.
Worth a project-level decision (not mine to make from inside a bead) on either scoping that test to
worktrees this session created, or documenting in `implement-bead` that a red tooling suite should be
checked against `git worktree list` before being treated as a real failure.
**Seen before.** None found (`grep -rl "cargoTargetDir\|stray worktree\|strayWorktrees"
docs/retrospectives/` turned up nothing).
