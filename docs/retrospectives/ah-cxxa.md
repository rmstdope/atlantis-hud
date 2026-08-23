# ah-cxxa — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** #614

## The disk floor was tripped with no reclaim available at all, because every large tree belonged to a live agent

**What happened.** `disk-preflight` refused the start at 5.5 GB against the 8 GB floor. The two
offline reclaims it names recovered 0.8 GB (`~/.cargo/registry/src` 235 MB, `Mozilla.sccache`
545 MB) and left it at 6.3 GB, still below the floor. The 5.5 GB that would have cleared it sat in
`.cerebro/worktrees/ah-8l9a` and `.cerebro/worktrees/ah-j00u` — both beads `in_progress` under
Cyclops and Storm, both agents in `asking`. `prune-worktrees.sh` correctly refused all three
worktrees ("it holds work that is not on main yet"), so there was nothing left that was safe to
delete. I asked the navigator, who chose to wait; space appeared about five and a half minutes
later when another agent finished, and the bead then ran start to finish without incident.

**Why.** Established. This is the ordinary steady state of a busy fleet rather than a fault: two
concurrent implementers hold ~2.8 GB each, a third needs ~2.5 GB, and the floor is 8 GB. Nothing
was leaked and nothing was stale — the machine was simply full of work in progress.

**Cost.** About twelve minutes: the failed reclaims, one question to the navigator, and the wait.
No CI cycles, no rebase, nothing lost.

**Prevent by.** The eight prior sightings below are all about *what to delete*; this one is the case
where the answer is *nothing, wait*. `implement-bead`'s *Workspace* section tells an implementer to
run `disk-preflight` and stop on non-zero, but says nothing about what to do next. Adding one line
there — when every large tree belongs to a live agent, block and poll the preflight rather than
asking or handing back, because the space arrives on its own as beads merge — would have turned this
into a silent wait instead of a navigator question. `disk-preflight` itself could say it: it already
knows which trees it refused and why, so a closing line distinguishing "cold trees you may prune"
from "live trees, wait" would put the answer where the failure is read.

**Seen before.** Eight files describe the same floor from the deletable-cache side: `ah-y3j1`,
`ah-udff`, `ah-9r0`, `ah-tdsi`, `ah-8m0.2`, `ah-kdgc`, `ah-j0e`, `ah-1znc`. None of them covers the
no-reclaim-possible case.
