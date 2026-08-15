# ah-3bl — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-15
- **PR:** rmstdope/cerebro#18, atlantis-hud#264

## `git -C .claude/cerebro worktree add` with a relative target path nests the worktree inside the submodule

**What happened.** Setting up the cerebro-repo worktree for PR 1, I ran
`git -C .claude/cerebro worktree add -b ah-3bl-bishop-architect .claude/worktrees/ah-3bl-cerebro
origin/main` from the atlantis-hud root, expecting the new worktree at
`atlantis-hud/.claude/worktrees/ah-3bl-cerebro`. It landed instead at
`atlantis-hud/.claude/cerebro/.claude/worktrees/ah-3bl-cerebro` — nested inside the submodule
itself, one level too deep and outside the directory the skill says worktrees must live under.
`git -C .claude/cerebro worktree list` was what surfaced it.
**Why.** `-C .claude/cerebro` changes git's working directory *before* it parses the rest of the
command, so the relative path argument is resolved against `.claude/cerebro`, not against the
shell's actual cwd. This is ordinary `-C` behaviour, not a bug, but it is easy to reach for the
`-C <submodule>` form out of habit (the rest of a cerebro-repo worktree setup uses it) without
noticing the target path needs to be absolute instead.
**Cost.** About 2 minutes: `worktree remove --force` on the misplaced tree, `worktree prune`, and a
second `worktree add` with an absolute path.
**Prevent by.** When creating a worktree for the cerebro repo specifically (`git -C .claude/cerebro
worktree add ...`), pass an **absolute** path for the target — as the *Workspace* section already
shows for the ordinary atlantis-hud case — rather than a path relative to the consumer root. Worth a
one-line callout in `implement-bead`'s two-PR cerebro delivery guidance, since every implementer
doing one of these bumps runs this exact command shape.
**Seen before.** None found (`ah-4ao`, `ah-aao`, `ah-axj` cover a different cerebro-worktree trap —
an uninitialized submodule inside a *fresh implementer* worktree, not the cerebro repo's own
`worktree add` path resolution).
