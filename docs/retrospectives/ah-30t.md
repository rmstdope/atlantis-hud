# ah-30t — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-16
- **PR:** #320 (atlantis-hud bump), rmstdope/cerebro#44

## A fresh implementer worktree leaves `.claude/cerebro` uninitialized, again

**What happened.** After `git worktree add -b ah-30t-bump-cerebro .cerebro/worktrees/ah-30t
origin/main`, `git submodule status` showed `.claude/cerebro` with a leading `-` (uninitialized).
`git -C .claude/cerebro fetch` then printed messages for the **atlantis-hud** remote
(`From https://github.com/rmstdope/atlantis-hud`) instead of cerebro's, and the following
`git -C .claude/cerebro checkout <cerebro sha>` failed with `fatal: unable to read tree` — because
the uninitialized directory has no `.git` of its own, so git commands there walk up to the
superproject. Running `git submodule update --init` fixed it immediately.

**Why.** `git worktree add` does not run `git submodule update --init`. Confirmed, not guessed —
this is the same root cause already recorded in ah-4ao and ah-aao.

**Cost.** About two minutes: the failure mode is confusing on first read (wrong-remote fetch output
reads like a misconfigured remote, not an uninitialized submodule) but is quick to diagnose once you
know to check `git submodule status`.

**Prevent by.** ah-4ao recorded this in 2026 and proposed folding `git submodule update --init
--recursive` into `implement-bead`'s *Workspace* section as an actual step, not just a retrospective
note. ah-aao hit it a second time and repeated the recommendation. ah-axj hit it a third time. This
is the fourth sighting of the identical failure mode across at least four separate beads, all
touching `.cerebro/worktrees/<id>` — the fix has not been promoted into the skill despite being
flagged three times already. Worth escalating past "note it again": the skill step is one line
(`git submodule update --init --recursive` right after `git worktree add`, before touching
`.claude/cerebro`) and would have prevented all four sightings.

**Seen before.** ah-4ao, ah-aao, ah-axj (same root cause: `git worktree add` skips submodule init).
ah-3bl is related but distinct (a nested-worktree path bug rather than an uninitialized submodule).
