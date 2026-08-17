# ah-gdp — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #371, plus rmstdope/cerebro#50 (the sweep half, per the bead's two-repository plan)

## The main checkout's stale `.claude/cerebro` pin served a fresh session skill text one submodule bump behind

**What happened.** At session start the `implement-bead` skill I was handed still described
`Workspace` as a raw `git worktree add` followed by `pnpm install` - no `prepare-worktree`, no
submodule-init step. `.claude/skills/implement-bead` symlinks into `.claude/cerebro/skills/…`, and
the main checkout's `.claude/cerebro` submodule was still pinned at `bbfa374`, one commit behind
`ah-2sy`'s merge (`3621c84`, "bump cerebro to pull in prepare-worktree") that had already landed on
`origin/main`. My own worktree, branched fresh from `origin/main`, carried the current submodule pin
and the updated skill text calling `prepare-worktree` - a different version of the same file from the
one I had already read. I noticed only because I went looking at `prepare-worktree` directly out of
unrelated curiosity about the two-repository split, and ran `git submodule update --init --recursive`
myself before it caused a failure.
**Why.** Nothing updates the main checkout's submodule pin after a `chore: bump cerebro` PR merges
elsewhere - `git submodule update` there is a manual step nobody owns, so `origin/main`'s content and
what a freshly-started session reads via the symlinked skill can disagree for as long as that gap
lasts. ah-2sy's own fix (routing worktree setup through `prepare-worktree`, which runs the missing
`submodule update --init` for a *new worktree*) does not help the *main checkout* itself go stale in
the same way.
**Cost.** Low this time - a few minutes, and no actual failure, because I checked before it bit me.
Every session started against a stale main-checkout pin between now and whenever someone next updates
it reads the same outdated instructions, though, which is the four-retrospectives-in-two-days shape
this whole bead already exists to fix for the build tree.
**Prevent by.** Something in the launcher path (`run-implementer`, or `launch-preflight`) refreshing
the main checkout's `.claude/cerebro` submodule pin to `origin/main`'s tracked commit before a session
starts reading skills out of it - the same kind of preflight `launch-preflight` already runs for a
missing role file, one step earlier.
**Seen before.** ah-4ao.md ("A fresh implementer worktree does not carry an initialized submodule")
is the same family of problem - a submodule step nobody owns - but at the worktree layer, and its own
fix is what went unpropagated here.
