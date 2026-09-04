# ah-lyg6.1.2.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-04
- **PR:** #930

## A plan said the browser suites were untouched while asking for an IndexedDB version bump

**What happened.** The plan's *test plan* stated that "the browser suites (`test:smoke`, `test:pwa`)
exercise no path this bead touches — nothing renders — and are left to CI", and its *Validation*
section asked only for `pnpm run check:fast`. But the same plan asked for
`GAME_DATABASE_VERSION` 4 → 5 in `packages/browser-core/src/webStore.ts` and a new
`create(ALLIED_MAGE_STORE, ["factionId", "unit.unitId"])`. That upgrade runs on every existing
browser game, and `webStore.test.ts`'s own header says the IndexedDB half cannot be reached from
vitest — its upgrade path is proved in the Playwright suite. The review sub-agent raised it; CI's
`smoke (web, 1, 2)` and `smoke (web, 2, 2)` were green, so nothing broke.

**Why.** "Nothing renders" was taken as the test for whether a browser suite is exercised. A
database version bump changes browser behaviour without rendering anything, so the two are not the
same question.

**Cost.** None to this bead — CI covered it and the change was correct. Recorded because the
mistake is repeatable: the next storage bead will copy this plan's shape, including its test plan.

**Prevent by.** A plan that changes `GAME_DATABASE_VERSION` (or adds an object store) should name
`test:smoke` in its *Suites that must run*, whatever it says about rendering — the smoke suite is
the only thing that opens a real IndexedDB. Worth a line in `plan-bead`'s guidance or in
`.cerebro/traps.md` beside the existing "`GAME_DATABASE_VERSION` guards existing databases" trap,
which today warns the implementer about the `create` guard but says nothing about which suite
proves the upgrade.

**Seen before.** None found — `grep -l GAME_DATABASE_VERSION docs/retrospectives/` matches nothing.
