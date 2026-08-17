# ah-do8.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #377

## `agent-state` failed from inside the bead worktree, for the sixth recorded time

**What happened.** The first `.claude/cerebro/scripts/agent-state Storm working --bead ah-do8.1
--phase gate --pid $PPID` call, run from `.cerebro/worktrees/ah-do8.1` per the skill's phase table,
failed with "no such file or directory": `.claude/cerebro` is an empty, uninitialized submodule
directory in a fresh worktree. Calling the script by its absolute path in the shared checkout
(`/Users/henrikku/repos/atlantis-hud/.claude/cerebro/scripts/agent-state`) worked immediately, and
every later phase write used that.

**Why.** `git worktree add` does not initialize submodules, exactly as recorded on ah-brd; and the
skill's phase table gives the call as a repo-relative path, which resolves against whatever cwd the
implementer is in — which, from the *Building* phase onward, is always the worktree.

**Cost.** About one minute, and one silently skipped state write (the `gate` phase was not published
until the retry, so the fleet view showed `build` for the duration of the first gate run).

**Prevent by.** Either of the two fixes already proposed on ah-brd and ah-2n3.1 would have stopped
this; neither is in place. The cheaper of the two: write the paths in `implement-bead`'s phase table
as absolute paths rooted at the shared checkout (or have the launcher export the script path as an
environment variable), since the relative form is wrong for every call after *Workspace*.

**Seen before.** ah-brd (fifth sighting, itself naming four earlier ones), ah-2n3.1 (the same
relative-path resolution problem, for `implementer-state`).
