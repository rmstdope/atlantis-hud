# ah-qled.10.5 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-22
- **PR:** #548 (application), rmstdope/cerebro#89 (harness)

## `git -C .claude/cerebro worktree add` with a relative path nested the worktree inside the submodule, for the third recorded time

**What happened.** A cerebro-side bead needs a worktree of the submodule, and the skill's
`prepare-worktree` only makes application worktrees. Following the directory convention the earlier
beads left behind (`.cerebro/worktrees/<id>-cerebro`), I ran

    git -C .claude/cerebro worktree add -b <branch> .cerebro/worktrees/<id>-cerebro origin/main

and it landed at `.claude/cerebro/.cerebro/worktrees/<id>-cerebro` — inside the submodule, not
beside the others. Unpicking it cost a `worktree remove`, an `rm -rf`, a `prune`, and a second
`worktree add` that then failed because the branch it had already created still existed, so the
recovery is three commands rather than one.

**Why.** `git -C <dir>` resolves a relative worktree path against `<dir>`, not against the shell's
cwd. Established.

**Cost.** About five minutes and four recovery commands. Small each time — and that is the point:
this is the third recorded sighting (ah-3bl, ah-90gu), so the fleet has now paid it three times
without it becoming cheaper.

**Prevent by.** `prepare-worktree` growing a `--repo cerebro` (or `--submodule`) mode that places a
submodule worktree at `<consumer>/.cerebro/worktrees/<id>-cerebro` by absolute path, the same way it
already refuses an application worktree outside `.cerebro/worktrees/`. The convention exists in five
directory names and in three retrospectives, and in no script. Failing that, one line in
`implement-bead`'s *Workspace* section saying a submodule worktree takes an **absolute** target path.
This is the navigator's to decide; a change to the skill or to cerebro's scripts is outside this
bead.

**Seen before.** ah-3bl (same command, same nesting), ah-90gu (the same, plus the observation that
a cerebro-only bead has nowhere documented to put its worktree).
