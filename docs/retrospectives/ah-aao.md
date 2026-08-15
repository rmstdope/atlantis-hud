# ah-aao — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-15
- **PR:** rmstdope/cerebro#13, atlantis-hud#253

## A fresh worktree's submodule checkout silently operated on the wrong repo again

**What happened.** For the atlantis-hud bump PR, `git worktree add -b ah-aao-bump-cerebro
.claude/worktrees/ah-aao origin/main` left `.claude/cerebro` uninitialized. A plain
`git checkout origin/main` inside that directory reported success and even printed a plausible
looking commit (`eb6bdc4 Release v0.7.0`) — but that hash was atlantis-hud's own tip, because the
uninitialized directory has no `.git` of its own and every git command there walks up to the
enclosing worktree. It also detached the *superproject's* HEAD in the process, which briefly cost
my `git commit` (it landed detached, not on `ah-aao-bump-cerebro`, and had to be recovered with
`git branch -f ah-aao-bump-cerebro HEAD && git checkout ah-aao-bump-cerebro`).
**Why.** Same root cause ah-4ao already recorded: `git worktree add` does not run
`git submodule update --init`. `git submodule sync && git submodule update --init --recursive`
fixed it once run.
**Cost.** About 10 minutes: diagnosing the wrong remote, then recovering the detached HEAD.
**Prevent by.** ah-4ao's fix ("run `git submodule update --init --recursive` right after
`pnpm install`, before touching `.claude/cerebro`") has not yet been folded into the
`implement-bead` skill's *Workspace* section — this is the second implementer to pay for that gap
rather than the skill catching it. Worth promoting from a retrospective note to an actual step in
the skill now that it has cost two separate runs.
**Seen before.** ah-4ao — same symptom, same fix.
