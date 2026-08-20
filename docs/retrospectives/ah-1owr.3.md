# ah-1owr.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #453

## The zustand SSR trap again, with the fix already in the tree and nothing pointing at it

**What happened.** The plan's increment 8 asked for a `UnitTableDock` test driving the column order
from the workspace store. `setUnitColumnOrder(...)` then `renderToStaticMarkup(<UnitTableDock/>)`
rendered the shipped order every time, while `useWorkspaceStore.getState()` in the same test showed
the value had landed. I diagnosed it from zustand's `react.js` (`useStore` hands `getInitialState`
to `useSyncExternalStore` as the server snapshot), then tried to work around it by overriding
`useWorkspaceStore.getInitialState` — which does nothing, because `useStore` closes over the `api`
object rather than the bound store `Object.assign` copied the function onto. I had written the
weaker test and moved on before noticing `packages/shared/src/testing/storeState.ts`, which exists
for precisely this and is used by `SettingsDialog.test.tsx` four files away.

**Why.** The trap is on file — `docs/retrospectives/ah-o1t.2.md` diagnosed it and its **Prevent by**
asked for "a line in `implement-bead`'s traps list". That line was never added, and the helper that
came out of it is named in neither the skill nor this bead's plan. So the second implementer to hit
it paid most of the first one's diagnosis again and nearly shipped a weaker test for it.

**Cost.** About 25 minutes, and a test that briefly asserted less than the plan asked for.

**Prevent by.** Adding the line ah-o1t.2 already asked for, naming the helper rather than the
symptom: *"`renderToStaticMarkup` reads a zustand store's `getInitialState()`, not its live state.
Use `setStoreStateForTest` / `restoreStoresForTest` from `packages/shared/src/testing/storeState.ts`
— overriding `getInitialState` on the bound store does not work, since `useStore` closes over the
underlying api."* A plan that asks for a store-driven static-markup test should name the helper too.

**Seen before.** `ah-o1t.2` — same cause, and its prevention was never applied.

## Adding an `aria-label` to a new control broke two unrelated smoke tests, and only CI said so

**What happened.** Every units-table header gained a reorder grip with
`role="button" aria-label="Move the Men column"`. Two long-standing tests in the same file locate
the sort control as `getByRole("button", { name: "Men" })` — a substring match — which now resolves
to both elements, and both failed on a Playwright strict-mode violation. Locally I had run only
`pnpm run test:smoke -g "shows where it will land"`, so nothing showed it until CI.

**Why.** A `-g` run tests the case you wrote, not the cases your change reaches. An accessible name
is a shared namespace: adding one to a new control inside an existing container silently widens what
every non-exact `getByRole(..., { name })` in that container matches.

**Cost.** One CI cycle, about 20 minutes, plus a 7-minute full local smoke run to be sure there were
no others.

**Prevent by.** When a change gives a new control an accessible name inside a surface the smoke
suite already drives, run that whole spec file locally (`pnpm run test:smoke tests/smoke/<file>`)
rather than `-g` on the new case. Cheaper still, and worth a line in `implement-bead`'s traps:
`grep` the smoke suite for `name: "<the label's words>"` before pushing — here
`grep -rn 'name: /\?\(Men\|Unit\|Faction\)' tests/` would have found it in seconds.

**Seen before.** None found.
