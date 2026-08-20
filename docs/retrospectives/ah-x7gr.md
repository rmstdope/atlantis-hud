# ah-x7gr — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** #492

## A bead whose own plan named a blocker had no dependency edge for it

**What happened.** `bd ready --label planned --claim` handed me `ah-hiib.3`, which I claimed and
began reading. Its plan opens *"Blocked on **ah-hiib.1** (the log) and **ah-hiib.2** (reading it),
deliberately"*, and an acceptance criterion requires cadence defaults *"taken from ah-hiib.2's
measured idle distribution (and the measurement stated in the PR)"*. `ah-hiib.2` was `in_progress`
under another implementer at that moment, with its `scripts/fleet-history` sitting untracked in the
cerebro submodule. The bead's declared dependencies were `ah-hiib.1` and `ah-4xm4` only, so nothing
kept it off `bd ready`.

**Why.** The plan states the blocker in prose without `bd dep add` having been run for it. Prose is
not a dependency edge, and `bd ready` reads only the edges.

**Cost.** Small this time — about five minutes to claim, read, diagnose and release, plus one
`bd dolt push` cycle. It would have been an entire wasted bead had I built to the plan and invented
the intervals, which the plan's own *Known traps* explicitly forbids.

**Prevent by.** `plan-bead`'s SKILL.md should require that every bead named as a blocker in a plan's
*Context* also gets a `bd dep add <bead> <blocker>` before the `planned` label goes on, and say that
the edges are what `bd ready` reads. I added the missing edge (`bd dep add ah-hiib.3 ah-hiib.2`) and
unclaimed rather than handing the bead to `human`: a missing edge is a fact to correct, not a
decision for the navigator, and the edge alone keeps the bead off `bd ready` until `ah-hiib.2`
closes.

**Seen before.** None found.

## A plan listed a submodule path among its files without naming the two-PR delivery

**What happened.** ah-x7gr's plan has a *Files to change* section listing
`.claude/cerebro/agents/orchestrator.md` alongside `scripts/retroSightings.ts` and `package.json`,
with no note that the first is inside the `.claude/cerebro` submodule. It cannot ride in the same
PR: it needs a cerebro PR of its own and then a pin bump, and the ordering is forced the other way
round from the usual one, because the sweep instruction names `pnpm sightings` and so must merge
*after* the atlantis-hud script exists.

**Why.** Plans that touch cerebro usually say *"Cerebro change, so **two PRs**"* explicitly —
`ah-hiib.3`'s plan, read in the same session, does exactly that. This one listed the path and did
not. Nothing in the plan template makes the submodule boundary visible when only one of several
files crosses it.

**Cost.** Roughly fifteen minutes, and two extra PRs discovered mid-run rather than planned for. No
rework, because it was caught before committing.

**Prevent by.** `plan-bead`'s SKILL.md should say that any path under `.claude/cerebro/` in a
*Files to change* list obliges the plan to state the PR split and the merge order in that same
section — a grep for `.claude/cerebro/` over the file list is enough to catch it, and it is cheap
enough to be a checklist item rather than a judgement.

**Seen before.** ah-axj and ah-3bl both ask for callouts in `implement-bead`'s two-PR cerebro
delivery guidance, but about the mechanics of making the worktree rather than about a plan failing
to declare the split. Related, not the same.
