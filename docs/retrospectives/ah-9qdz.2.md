# ah-9qdz.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-12
- **PR:** #1516

## A rule about what an edit does took three review rounds because it was built as a render-time effect

**What happened.** The agreed experience removes a planned cast from the plan when an earlier
study change leaves the mage no castable spell on that turn. The first build pruned in a
`useEffect` in `StudyPlannerDialog` whenever the grid showed no cast half. Each review round then
found a new way it was wrong:
- round 1: the shelter forecast, this month's orders and an old ruleset also hide halves, so
  casts were erased;
- round 2: a snapshot taken at commit never settled after a no-op re-pick or a failed save, and
  a teacher's edit stranded his student's cast;
- round 3: snapshots raced the store's queued writes, note saves and schedule reshapes.

The fix that held moved the rule into the write. `studyPlansStore.save` takes a `settle(before,
after)`, run inside the edit's own queued write, and the records it answers are written in the
same call.

**Why.** The rule is about a *transition*, the plans just before an edit and just after it. A
render sees only states. Any effect has to reconstruct the transition from snapshots, and every
snapshot can be stale against the write queue. The plan chose the effect because the ah-nass trap
steers effect logic into pure modules, and it never asked whether the rule was about a state or
about an edit.

**Cost.** Three follow-up review rounds, three fix commits, one rewrite of the mechanism, and
about an hour of wall-clock.

**Prevent by.** A paragraph in `.cerebro/traps.md` beside the ah-nass entry: "A rule triggered by
an edit (this change makes that one invalid) belongs in the edit's queued write -
`studyPlansStore.save`'s `settle` is the pattern - never in an effect that compares renders."

**Seen before.** None found.

## The local Playwright browser was missing again

**What happened.** The first local smoke run failed every walk with `browserType.launch:
Executable doesn't exist at ~/Library/Caches/ms-playwright/chromium_headless_shell-1234/...`.
Running `pnpm exec playwright install chromium` fixed it.

**Why.** Not established. This is the same gap ah-07tn recorded.

**Cost.** One wasted smoke run and a 95 MB download, a few minutes.

**Prevent by.** The prevention ah-07tn names: `prewarm` in `.cerebro/project.conf` runs
`pnpm exec playwright install chromium`.

**Seen before.** ah-07tn.
