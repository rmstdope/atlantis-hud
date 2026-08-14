# ah-3cs — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-14
- **PR:** #236

## Two implementers claimed the same bead and edited the same worktree concurrently

**What happened.** After claiming ah-3cs (`bd update ah-3cs --claim`, confirmed `in_progress` with
a fresh lease), I found `.claude/worktrees/ah-3cs` already existed with a clean tree at the
mockup-PR commit and reused it, as the skill's *Picking up* section describes for a reopened bead
— nothing distinguished this from that case at the time. While I was mid-implementation, my own
file edits kept coming back from the `Edit`/`Read` tools annotated as "modified, either by the user
or a linter" and, on inspection, already contained work I had not written yet (the `SettingsDialog`
checkbox, the smoke test, extra test cases) — content that turned out to be correct and consistent
with the plan, so I initially assumed a background formatter. Checking
`.claude/implementers/*.state.json` mid-run showed a second implementer, Storm, also `working` on
`ah-3cs` since one second after my own claim timestamp, and `bd show ah-3cs` had only one
`assignee`/lease shared between us (bd does not key a claim by session, only by the shared git
identity both implementers write as). Sending Storm a status message coincided with its state
flipping to `idle, bead: null` — its session had ended (cleanly or crashed) by the time I checked,
so the collision resolved itself before I had to arbitrate it by hand, and no worktree or branch
was left behind for it to clean up.
**Why.** Worktree paths are keyed only by bead id (`.claude/worktrees/<id>`), with no session
component, so `bd`'s atomic claim (which does protect against two implementers building the same
bead) has nothing to say about two sessions that raced to claim it within the same second and both
happened to land in the one worktree directory that bead id maps to. `bd`'s own claim likely did
serialize correctly under the hood; what is not isolated is the filesystem location the second
claimant reused.
**Cost.** Roughly ten minutes of confusion mid-RED/GREEN chasing what looked like unexplained file
drift, plus the risk (not realized here, but real) of two sessions' uncommitted edits interleaving
destructively in the same files before either commits.
**Prevent by.** Name agent worktrees by bead id *and* session (e.g.
`.claude/worktrees/<bead-id>-<implementer-name>`), or have the *Picking up* step in `implement-bead`
check `bd show <id>`'s `assignee`/lease freshness against the claiming session's own identity before
reusing an existing worktree, rather than treating "worktree already exists and is clean" as
sufficient grounds to reuse it.
**Seen before.** None found (`docs/retrospectives/` did not exist before this bead).
