# ah-rjz2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-18
- **PR:** #1734

## A new ⚠ on a fixture unit's Silver cell broke the smoke suite's selectUnit, and only CI said so

**What happened.** The fast gate was green, and CI's `smoke (web, 2, 2)` failed two tests in
`tests/smoke/workspace.spec.ts` ("an orders file imports through the confirm prompt" and its
neighbour) with `strict mode violation: getByTestId('unit-row-18642').getByRole('button', { name:
'unit 18642' }) resolved to 2 elements`. The bead puts the money ⚠ on any unit whose STUDY is
refused, and fixture unit 18642's standing `@study obse` is refused when the imported orders give it
no silver, so its Silver cell became a button whose accessible name starts "unit 18642" — and
`selectUnit` in `tests/smoke/gameSetup.ts` matched the row's unit button by a non-exact name.

**Why.** Playwright's `name` option matches a substring unless `exact: true` is given, so any
second control in a row named after its unit makes the helper ambiguous. The unit tests cannot see
this: it needs a rendered table with a forecast on that fixture.

**Cost.** One CI cycle (about 13 minutes) and a local run of the two smoke tests.

**Prevent by.** `selectUnit` (and `foreignUnits.spec.ts`'s twin) now pass `exact: true`, done in
this bead. For the next bead that adds a ⚠ or any button to a row cell: run the smoke shard that
covers `workspace.spec.ts` locally (`smoke-port -- pnpm run test:smoke -- --project=web
tests/smoke/workspace.spec.ts`) before the PR, as `implement-bead`'s *Building* could say for any
change to which cells are controls.

**Seen before.** ah-bu2c ("Adding a control inside a units-table row broke six smoke helpers, and
only CI said so") — the same helper, the same cause, a different control.
