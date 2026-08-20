# ah-bwly.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #470

## `a folded panel shrinks to its title bar` failed in CI and passed locally, for the third time

**What happened.** `smoke (web, 2, 2)` failed on two specs, neither of which my diff can reach:
`tests/smoke/workspace.spec.ts:1433` (`a folded panel shrinks to its title bar`, on
`expect(strip.y).toBeCloseTo(open.y, 0)` — the identical assertion `ah-l2i.3` recorded, at a line
that has since moved from 1353 to 1433) and `tests/smoke/workspace.spec.ts:3399`
(`clicking empty ground names the hex that was clicked`, which timed out still showing the previously
selected hex's region pane). Both failed on Playwright's own retry too. The full local smoke suite
had passed 426/426 on the same commit beforehand, and re-running both specs directly afterwards
passed in 7.8 seconds. One CI re-run of the failed job was green on every check.

**Why.** Not established, and deliberately not guessed at. `ah-l2i.3` reached the same point on the
fold spec and stopped there. What this run adds is that a *second* geometry-and-timing spec in the
same file failed in the same job on the same run — `clicking empty ground` asserts on pane content
after a map click, which is the same shape of "measure straight after the interaction" the fold spec
is. That they went together, on a shard whose other 200-odd tests passed, points at the runner being
loaded rather than at either spec individually.

**Cost.** One CI cycle (~9 minutes wall-clock across the shards) plus about two minutes reproducing
locally. No code change, no hand-back.

**Prevent by.** `ah-l2i.3`'s prevention still stands and is now overdue: the fold spec should wait
on the fold having settled rather than measuring straight after the click. This sighting argues for
widening that bead rather than filing a second one — the fix wanted is the same for
`clicking empty ground`, and probably for every spec in `workspace.spec.ts` that measures geometry
or pane text immediately after an interaction. Filing or widening it is the navigator's call, not
mine; what this file adds is that it is now three sightings across three unrelated beads, two of
them on diffs (mine and `ah-l2i.3`'s) that touch no front-end layout at all.

**Seen before.** ah-l2i.3 — same spec, same assertion, same "Rust-only diff, green on re-run". ah-2r3
— same spec, though there it was a real consequence of a layout change rather than a flake.
