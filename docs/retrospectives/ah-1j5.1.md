# ah-1j5.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #356

## Write/Edit calls landed in the main checkout, not the worktree, because they carry no cwd of their own

**What happened.** After `cd`-ing into `.cerebro/worktrees/ah-1j5.1` in a `Bash` call, I used `Write`
to create `crates/core/src/trade.rs` and `Edit` to modify `crates/core/src/lib.rs` and
`crates/core/src/movement/plan.rs`, all with paths relative to the repository root (e.g.
`crates/core/src/trade.rs`). All three landed in
`/Users/henrikku/repos/atlantis-hud/` - the navigator's own shared checkout - rather than in the
worktree. `git status` in the worktree showed nothing; `git status` in the main checkout showed the
new file and the two edits. Caught before any commit, by running `git status` in the main checkout as
a sanity check rather than trusting the worktree looked right.

**Why.** `Bash`'s working directory persists between `Bash` calls, but `Write` and `Edit` do not read
or share it - they resolve a relative `file_path` against some other process-level cwd (this
session's own starting directory, the repository root), which had never changed. `cd`-ing in `Bash`
only ever affects the next `Bash` call.

**Cost.** About 10 minutes: noticing via an unrelated `git status`, `git restore` on the two modified
files and `rm` on the new one in the main checkout to leave the navigator's tree exactly as found, then
redoing all three changes with absolute paths inside the worktree.

**Prevent by.** Use absolute paths (`/Users/.../.cerebro/worktrees/<id>/...`) with `Write` and `Edit`
from the first call in a bead, never paths relative to a `Bash cd`. Worth a line in
`implement-bead`'s *Workspace* section: `Write`/`Edit` file paths are not affected by a prior `Bash
cd` and must be absolute (or repo-root-relative from an unmoved root) to land in the worktree at all.

**Seen before.** none found (`grep -rl "Write\|Edit" docs/retrospectives/` turned up nothing about
tool cwd specifically).
