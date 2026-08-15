# ah-o1t.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-15
- **PR:** #272

## `renderToStaticMarkup` can never see a zustand store's non-default state via `.setState(...)`

**What happened.** `RegionNotes.test.tsx`'s first RED tests set the store to various states with
`useHexNotesStore.setState({...})` before calling `renderToStaticMarkup`, expecting the component
to reflect them. Every one rendered as if the store were still at its module-load default
(`status: "idle"`), no matter what `.setState` had just written.
**Why.** Zustand's React binding (`react.mjs`) calls `React.useSyncExternalStore` with two
snapshot getters — `() => selector(api.getState())` for a live render and
`() => selector(api.getInitialState())` for the server one. `react-dom/server`'s
`renderToStaticMarkup` always takes the second path, and `getInitialState()` returns the literal
object `createState(...)` produced at module load, which `setState` never touches (it always
builds a new `state` object rather than mutating the old one). Every other test in this
codebase that uses `renderToStaticMarkup` against a zustand store only asserts the store's
*default* values for exactly this reason — none had previously needed the store in a state other
than what it starts in.
**Cost.** About 20 minutes: two failing assertions that looked like a component bug before the
store's own `getState()` inside the same test proved the write had landed and the render still
didn't see it.
**Prevent by.** A store whose tests need `renderToStaticMarkup` to see non-default state needs a
test helper that writes through both `setState` (for `getState()` reads) and mutates the object
`getInitialState()` returns (for the SSR read) — `setHexNotesStateForTest` in `hexNotesStore.ts`
is the pattern now on file. Worth a line in `implement-bead`'s traps list, since the existing
`BadgeMenu.test.tsx` note ("no jsdom, so clicking is the smoke suite's job") is adjacent but does
not cover this: a component can be entirely clickless and still hit this the moment a test wants
the store to answer with anything but its own defaults.
**Seen before.** None found.

## An optimistic UI update can render before its own write is durable, and a smoke test can outrun it

**What happened.** The first version of the "a note written on a hex is still there after a
reload" smoke test asserted the new note row was visible (with its turn stamp) and then called
`page.reload()`. That test was reliably flaky — failing roughly one run in three across both
projects, occasionally on both the first attempt and its retry.
**Why.** `hexNotesStore.add()` updates its in-memory `notes` array optimistically *before*
awaiting `saveHexNote` (the actual IndexedDB write). The row the test was asserting on appears the
moment that first, synchronous `set()` runs — well before the awaited write's
`transaction.oncomplete` fires. `page.reload()` right after seeing the row could therefore land
before the write had actually committed, and the reloaded page — reading only what IndexedDB had
by then — showed no notes at all.
**Cost.** About an hour: several rounds of re-running the test to reproduce it, inspecting a
failing run's trace and accessibility snapshot to see the store had genuinely returned `ready` with
zero notes (ruling out a load-timing race), then reading `webStore.ts`'s write path to confirm it
was durable *once awaited* before landing on the actual bug.
**Prevent by.** Any optimistic mutation's completion signal in the UI needs to be something that
only happens after the full async chain (including the actual write) resolves — here, the editor
closing, which only happens once `RegionNotes`'s `save()` has awaited `add()` all the way through.
A smoke test asserting durability across a reload should wait for that completion signal, not for
the optimistic row to merely appear. Worth a line in `implement-bead`'s traps list next to the
existing ones about built-bundle staleness: "a row appearing is not proof its write landed, for any
store that updates optimistically before awaiting storage."
**Seen before.** None found.
