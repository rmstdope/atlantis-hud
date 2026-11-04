# ah-5z5vx — retrospective

- **Implementer:** Bishop (bugfixer)
- **Date:** 2026-11-04
- **PR:** #1918

## A smoke test pinned the behaviour the bug fix removed, and only CI saw it

**What happened.** The fix drops our own faction's units from a stale hex's remembered units. The
core tests and `pnpm run check:fast` were green, but CI's `smoke (web, 2, 4)` failed:
`tests/smoke/shortcuts.spec.ts` › "the palette finds historical units and map objects" searched for
Historical Scout (99999). Its fixture line gives that unit The Disinherited Knights (42), which is
the reporting faction, so the test had been asserting the very behaviour the bead calls a bug.

**Why.** The fast gate runs no browser suite, and before pushing I searched the Rust and `shared`
tests for `remembered_units` but not `tests/smoke/` for the screen surfaces that read it (the
palette's historical entries).

**Cost.** One CI cycle (about 10 minutes) and one of the bead's three fix attempts.

**Prevent by.** In `fix-bug`, step 5 (*Keep existing behaviour green*): when the fix changes what a
core resolution returns, grep `tests/smoke/` for the fixture data and the screen words its consumers
show (here "last seen turn", "Historical"), and run any matching spec under `smoke-port` before the
PR.

**Seen before.** ah-gfzu, ah-y4zb, ah-6cka, ah-20di (smoke tests contradicting a planned change,
found only in CI).
