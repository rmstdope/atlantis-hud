# ah-qled.5.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#77

## `bd heartbeat` fails from inside a bead worktree, so a long wait renews nothing

**What happened.** I avoided ah-qled.9's mistake by keeping the cerebro branch inside the
atlantis-hud worktree (`.cerebro/worktrees/ah-qled.5.2/.claude/cerebro`) rather than in a worktree of
the cerebro repository somewhere else. `bd heartbeat ah-qled.5.2` run from there still failed with
`no beads database found`: `.beads/` is git-ignored, so it exists only in the main checkout and never
in a worktree, and `bd`'s walk up from a worktree finds a repository root with no database. Worse,
the skill's own wait loop pattern (`until ...; do bd heartbeat <id>; ...`) is usually written with
the heartbeat's output discarded, so during a nine-minute review wait and a CI wait every heartbeat
failed silently and the lease was renewed only by the calls I happened to run from the main checkout.

**Why.** `.beads/` is git-ignored by design (the Dolt database is local), and a git worktree gets
only tracked files. Nothing about the submodule is needed to hit this — it applies to **every** bead,
since every implementer works from a worktree.

**Cost.** Minutes here, because I noticed the error text on one foreground call. The failure mode it
sets up is the expensive one: a claim that reads as abandoned through the longest waits in the run,
which is exactly what the heartbeat rule exists to prevent.

**Prevent by.** `implement-bead` naming this once: **every `bd` call runs with `-C <repo root>`**
(the main checkout), or the wait loop's heartbeat is written as
`bd -C "$repo_root" heartbeat <id>` in the skill's own snippet under *Waiting, without ending your
run*. The snippet as written today is what an implementer copies verbatim, and copied verbatim from
a worktree it does nothing. Not discarding the heartbeat's stderr in that loop would at least make
the failure visible.

**Seen before.** `ah-qled.9.md` — same error, same run of the fleet, but diagnosed there as a
submodule-worktree placement problem. This run shows the correct placement does not fix it: the
cause is the worktree, not the submodule.
