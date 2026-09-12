# ah-7ale.2.2.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-12
- **PR:** #1205

## A rules lookup run from the repository root sent the next two edits into the shared main checkout

**What happened.** Increment 1 needed `rules/sequenceofevents`, and the lookup tool is a package
script, so I ran `cd /Users/henrikku/repos/atlantis-hud && pnpm run atlantis rules sequenceofevents`.
The shell keeps its directory between `Bash` calls, so the two `python3` edits that followed — the
`StatePhase::Transport` insertion in `crates/core/src/orders/phases.rs` and the no-op ledger arm in
`crates/core/src/orders/semantics.rs` — were written to the **main checkout**, not to my worktree.
Nothing failed at the time: both edits applied cleanly and `git status` in the main checkout showed
two modified files. The symptom was a compile error in the worktree claiming `Intent::Transport` did
not exist, two commands later, which reads as a bad edit rather than as an edit in the wrong tree.
Recovered with `git diff > /tmp/stray.patch`, `git checkout --` in the main checkout and `git apply`
in the worktree.

**Why.** `implement-bead`'s *Workspace* section warns about `cd` into **another agent's worktree**
("Check `pwd` before any git command"), and that warning is about `git`. A `cd` to the repository
**root** to run a project script is the same hazard with a different destination and a non-git
victim: the main checkout is the navigator's, and a file edit there is worse than a branch move,
because it can be committed by somebody else without either of us noticing.

**Cost.** About five minutes, plus one confusing compile error. No lasting damage: the main checkout
was restored before anything was committed there.

**Prevent by.** Two things, either of which would have stopped it. (1) `implement-bead`'s *Workspace*
section should say that a lookup or any other project script is run **from the worktree** — every
`pnpm run` script in this repository works from a worktree, including `pnpm run atlantis` — rather
than by `cd`-ing to the root, and should widen "check `pwd` before any git command" to "before any
command that writes a file". (2) A wrapper that refuses a write under the shared root while a
worktree is checked out would catch it mechanically, which prose cannot.

**Seen before.** None found with this symptom. `docs/retrospectives/ah-do8.1.md` and
`ah-2n3.1.md` are the nearest: both are worktrees created in the wrong place, not edits landing in
the right place's shared parent.
