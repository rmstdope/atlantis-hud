# ah-90gu — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** #523 (and rmstdope/cerebro#71)

## A cerebro-only bead still has nowhere documented to put its worktree, and the relative path still nests

**What happened.** The whole change was inside the `.claude/cerebro` submodule, and neither
`implement-bead` nor CLAUDE.md says where such a bead's worktree goes — `prepare-worktree` makes a
worktree of the *consumer*, not of the submodule. I inferred the convention
(`.cerebro/worktrees/<id>-cerebro`) from a leftover tree in `git worktree list`, and then hit the
second half of the same trap: `git -C .claude/cerebro worktree add .cerebro/worktrees/ah-90gu-cerebro`
resolves the path relative to the submodule, so the tree landed at
`.claude/cerebro/.cerebro/worktrees/…` and had to be `git worktree move`d out.
**Why.** Established, and already written down three times: `git worktree add` resolves a relative
path against the repository it is run in, and there is no documented home for a submodule-side bead
worktree.
**Cost.** About three minutes, and a `worktree move` plus an `rm -rf` of the stray `.cerebro`
directory inside the submodule checkout.
**Prevent by.** Either `prepare-worktree` growing a `--submodule` mode that makes the cerebro
worktree at the conventional path with an absolute argument, or `implement-bead`'s *Workspace*
section naming `.cerebro/worktrees/<id>-cerebro` and saying to pass an absolute path. This is the
**fourth** recorded sighting with no change made, which is the reason for recording it again: the
count is the finding.
**Seen before.** ah-3bl (the relative path nesting, verbatim), ah-qled.9 (no documented home for a
cerebro-only bead), ah-aao (a fresh worktree's submodule checkout operating on the wrong repo).
