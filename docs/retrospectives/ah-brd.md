# ah-brd — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** #327

## A fresh worktree's uninitialized `.claude/cerebro` submodule broke the first `agent-state` write

**What happened.** After `git worktree add -b ah-brd-reject-no-faction-report
.cerebro/worktrees/ah-brd origin/main` and `pnpm install --frozen-lockfile`, the first
`.claude/cerebro/scripts/agent-state Cyclops working --bead ah-brd --phase gate --pid $PPID` call
(right before `pnpm run check:fast`, per the skill's phase table) failed with "No such file or
directory" — `.claude/cerebro` was an empty, uninitialized submodule directory in the new worktree.
`git submodule update --init --recursive` fixed it immediately.

**Why.** `git worktree add` does not run `git submodule update --init`, same as a plain `git clone`
without `--recurse-submodules`.

**Cost.** About 2 minutes: one failed state write, diagnosed and fixed with the init command before
continuing.

**Prevent by.** Add `git submodule update --init --recursive` to the `implement-bead` skill's
*Workspace* section, in the `git worktree add` / `pnpm install` block, so every worktree gets it
before the first `agent-state` call rather than only when a `.claude/cerebro`-touching bead notices
it is missing. This is the fifth sighting of the identical failure across five separate beads (see
below) with the same one-line fix proposed each time; worth promoting from a retrospective note to
an actual skill step rather than recording a sixth.

**Seen before.** ah-4ao, ah-aao, ah-axj, ah-30t — same root cause (`git worktree add` skips
submodule init), same fix, same unfulfilled recommendation to fold it into the skill.
