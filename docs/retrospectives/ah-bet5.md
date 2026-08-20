# ah-bet5 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #457

## Reverting a deliberate breakage with `git checkout` threw away the uncommitted implementation

**What happened.** The plan's *Validation* section asks the implementer to break the parser on
purpose three times and confirm the new check catches each — "Revert." after each. The
implementation was still uncommitted at that point (the gate had not run yet), so
`git checkout packages/ruleset/src/data.ts` reverted the breakage *and* both real edits: the
`SKILL_OPENING` export and the `readCastCost` rewrite. `grep -c "matchAll(CAST_INPUT)"` returned 0,
which is the only reason it was noticed before the gate.

**Why.** Established. "Revert" is ambiguous when the file also holds work that is not yet committed,
and the obvious command for it — `git checkout <file>` — reverts to HEAD, not to the pre-breakage
state.

**Cost.** About five minutes: re-applying two edits from the scrollback and one extra test run.

**Prevent by.** A plan whose validation asks for a deliberate breakage should say to **commit the
implementation first**, and then revert with `git checkout <file>`; or, if the work must stay
uncommitted, to snapshot the file (`cp <file> /tmp/<file>.good`) and restore from that copy. Either
is one line in `implement-bead`'s *Building* section or in the plan's own *Known traps*. The second
and third breakages here were reverted from a `/tmp` copy and cost nothing.

**Seen before.** None found — `docs/retrospectives/ah-aao.md` and `ah-4ao.md` both involve
`git checkout` in a worktree, but the mechanism there is submodule/worktree confusion, not
uncommitted work being discarded.

---

*Second run on this bead, after it was escalated for stalled CI and returned to the queue.*

- **Implementer:** Cyclops
- **Date:** 2026-08-20
- **PR:** #457

## CI stalls that looked like infrastructure were a branch predating a CI change on main

**What happened.** The first run escalated this bead with the PR open and green code: the four
`smoke` shards hit the 15-minute step timeout with no test failure, across two job re-runs and one
`update-branch`, while the full suite passed locally in 6.9m. Concurrent cancellations on `main`
made it read as GitHub Actions trouble. It was not. PR #465 merged at 17:50Z and moved the browser
jobs into `mcr.microsoft.com/playwright:v1.62.1-noble`, deleting the apt-based
"Install the Playwright browser" step the stalls were in; this branch was 15 commits behind and
still carried it. The earlier `update-branch` attempt happened *before* 17:50Z, so it caught up to a
main that still ran apt. One `update-branch` this morning and every shard passed first try.

**Why.** Established. The branch predated a merged CI change that removed the failing step.

**Cost.** The bead sat escalated overnight — roughly 15 hours of wall-clock — plus a planner session
to diagnose it. The second run itself cost one `update-branch` and one CI cycle, about 20 minutes.

**Prevent by.** Before escalating a CI failure as infrastructure, compare the branch against main
and check whether the failing step still exists there:
`gh api repos/<o>/<r>/compare/main...<branch> --jq .behind_by`, then read the failing job's step
name against `.github/workflows/ci.yml` on `main`. A branch that is behind has not been shown to
fail under current CI at all. That belongs in `implement-bead`'s *Red CI* section, which today says
"a wall of identical connection errors is infrastructure, not a defect" but says nothing about a
stale branch — and `Merging`'s `BEHIND` handling only runs *after* CI is green, so a branch that
never gets there never reaches it.

**Seen before.** None found for this mechanism. `ah-k6i.5.md` and `ah-k6i.6.md` concern
`update-branch` and merge-state, not a stale branch producing a false infrastructure diagnosis.
