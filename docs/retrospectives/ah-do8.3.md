# ah-do8.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #388

## `shortcuts.spec.ts:239` "right-click centres the view on a hex" failed in CI on a diff that touches no map code

**What happened.** `smoke (web, 1, 2)` failed on a transform assertion
(`expect.poll(() => mapTransform(page)).toBe("translate(945.09,-103.11) scale(0.5946)")`) on a PR
whose whole diff is `reportLoad.ts`, `AppShell.tsx`'s `applyLoadedTurn` and a test file — nothing
that can move the map. Run locally with `pnpm run test:smoke -g "right-click centres the view on a
hex"` it passed on the first attempt (2 tests, 8s), and a single `gh run rerun --failed` was green.
**Why.** Not established. The assertion compares a rendered transform to two decimal places after a
poll, so a layout that has not fully settled on a slower runner would produce exactly this; I did not
prove it.
**Cost.** One re-run, about six minutes of CI wall-clock, plus the local reproduction.
**Prevent by.** If it recurs, the spec's centring assertion (`tests/smoke/shortcuts.spec.ts:272` and
`:290`) wants a tolerance rather than exact string equality on the transform — but one sighting is
not yet evidence of a defect. Recording it so the second sighting has something to point at.
**Seen before.** None found — no other retrospective names this spec.

## The disk preflight blocked `check:fast`, not just the start of the bead

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at 9.6 GB when the bead started
and failed at 7.8 GB by the time `pnpm run check:fast` ran, taking `scripts/diskPreflight.test.ts`
down with it — the one red test in an otherwise green gate.
`prune-worktrees.sh` had nothing safe to reclaim (all four trees held live work).
**Why.** Other agents' build trees grew during the run; 8.3 GB sat in four of them.
**Cost.** A few minutes distinguishing an environmental gate failure from a real one, and a note in
the PR body explaining why one tooling test was red.
**Prevent by.** Nothing new for an implementer to do — this is the seventh-plus sighting and the
navigator already has it. Recorded only for the count, and for the one new detail: the preflight can
pass at the start of a bead and fail at its gate, so a green preflight at claim time is not a
guarantee for the run.
**Seen before.** ah-8m0.2, ah-9r0, ah-9lv, ah-do8.2, ah-l2i.1, ah-quw, ah-s0m.
