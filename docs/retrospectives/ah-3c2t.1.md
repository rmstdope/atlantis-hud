# ah-3c2t.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-09
- **PR:** #1147

## `prepare-worktree` has no route for resuming a handed-back bead's branch

**What happened.** This bead was handed back by a previous implementer with PR #1147 left open on
`ah-3c2t-1-settled-market-purse`, and its plan says in terms *"Start from the existing branch, do
not start again."* `implement-bead`'s *Workspace* section knows only one shape:
`prepare-worktree --path … --branch <new name>`, which is `git worktree add -b` and refuses a
branch name that already exists. A stale local `ah-3c2t-1-settled-market-purse` was still in the
main checkout from the previous implementer's run (its worktree had been pruned, the branch had
not), so the obvious command failed. What worked was

```bash
git branch -D ah-3c2t-1-settled-market-purse     # stale local ref, identical to origin's
.claude/cerebro/scripts/prepare-worktree --path .cerebro/worktrees/ah-3c2t.1 \
    --branch ah-3c2t-1-settled-market-purse \
    --from origin/ah-3c2t-1-settled-market-purse
```

The `git branch -D` is only safe because the local ref and `origin/` were the same sha; had the
previous implementer left unpushed work on it, deleting it would have destroyed exactly what the
plan told me to start from.

**Why.** `prepare-worktree`'s `--branch` mode is written for the common case — a fresh bead, a new
branch off main — and `--from` lets it start anywhere, but there is no mode that *checks out an
existing branch* into a new worktree (`git worktree add <path> <existing-branch>`, no `-b`). A
hand-back is the case that needs it, and hand-backs are exactly when the branch already exists.

**Cost.** Small — about five minutes, one failed command and a judgement call about whether the
local ref was safe to delete. Recorded because the judgement call is the dangerous part, not the
five minutes: an implementer in a hurry could `git branch -D` a branch carrying unpushed work.

**Prevent by.** Either give `prepare-worktree` a third mode that checks out an existing branch
(refusing when the local ref and its remote have diverged, which is the check that makes the
`-D` unnecessary), or add a paragraph to `implement-bead`'s *Workspace* section saying what to run
when the plan says to resume an existing branch — including the "verify local == origin before
deleting a stale local ref" step, which is the part an agent will otherwise improvise.

**Seen before.** None found. `grep -rl "prepare-worktree" docs/retrospectives/` returns ten files,
none about resuming an existing branch; `grep -l "branch -D"` returns none.
