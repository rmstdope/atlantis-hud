# Testing `packages/shared`

**This package renders without a DOM.** There is no jsdom, and there deliberately will not be:
adding one would cost a slower suite on every run and a second way to write a component test
alongside the forty-odd files that use the first way (decided with the navigator on ah-nass).

So a component test here calls `renderToStaticMarkup`, which **runs no effects, attaches no refs
and fires no timers**. React says nothing when it skips them — the effect simply does not happen,
and the assertion about what it should have done fails for a reason that names neither the harness
nor the cause. Four beads paid around half an hour each to work that out (ah-t2i, ah-o1t.2,
ah-1owr.3, ah-mwqa) before `noDom.ts` was written to say it out loud.

## The pattern: a pure module holding the rule, a thin component that measures

**Put the rule in a plain function and test that.** The component's job is to measure the browser
and call it — which is a job for the smoke suite, not for a unit test here.

`workspace/dossierPeek.ts` is the worked example. Where the map should go while the reader runs
down a faction dossier is `peekStep`, a plain function of a viewport and a rectangle, and its own
test file covers it exhaustively with no React at all.

The rest of the split is deliberately thin and deliberately untested here. `useReportedRect`, in
`workspace/FactionDossierPanel.tsx`, is the `useLayoutEffect` that reads a `DOMRect` and reports
its four numbers upward — the panel component itself must stay hook-free, so the measuring lives in
a wrapper (`MeasuredFactionDossier`) beside it. `workspace/MapCanvas.tsx` is what feeds those
numbers to `peekStep`. `workspace/tradeArrow.ts` is the sibling written first, and
`workspace/mapOverlayInsets.ts` + `workspace/useOverlayInsets.ts` are the same split again.

This is worth doing on its own merits rather than only as a concession: the rule ends up somewhere
trivial to test, and it stops being reachable only through a render.

**The honest limit.** A genuinely effect-shaped rule — one whose *content* is the sequencing of
observers and timers rather than an arithmetic on measurements — still cannot be tested in this
package. Moving the arithmetic out is the answer; what is left after that belongs in the smoke
suite. A pattern that claimed otherwise would be trusted in a case it does not cover.

## Store state: `renderWithStoreState`

A zustand store read through `useSyncExternalStore` shows a static render only its **module-load
default**, because React's server branch reads `getInitialState()`. A bare `store.setState(...)`
before `renderToStaticMarkup` therefore changes nothing at all.

```tsx
const markup = renderWithStoreState(<GlobalSettings />, useSettingsStore, { theme: "light" });
```

Call it with no patch after driving the store through its own actions, and put
`restoreStoresForTest` in an `afterEach` as before. `storeState.ts` has the detail.

## Finding an element without a DOM — `elementTree.ts`

A click here is exercised by calling the button's own `onClick` prop, which means finding the button
in the unrendered element tree. `queryByTestId` walks that tree; `findByTestId` is the same walk that
throws when it misses, and its message names every component the walk could not enter — a component
is entered by *calling* it, which works only while it uses no hooks, so an id inside `PopoverFrame`
is an id no test in this package can reach. That distinction is why the throwing form exists: a
*unreachable* id and an *absent* one are different problems and used to produce the same
`expected null not to be null`.

```tsx
findByTestId(panel(), "dossier-hex-1:8,54").props.onClick as () => void; // present, or a real message
expect(queryByTestId(panel(), "dossier-back")).toBeNull();             // asserting absence
```

Two test files carried a private copy of that walk until ah-2ihm; a hook added below them reddened
both at once. There is one copy now.

## Nothing here ships

**No module in this directory may be imported by production code, and `src/index.ts` must not
re-export it.** There is no build step in this package, so a module nothing imports is a module
nothing ships — and that is the whole protection.

`setup.ts` is wired into `packages/shared/vitest.config.ts` and prints the paragraph in `noDom.ts`
beside any red in a file that renders components, so the explanation arrives while somebody is
already looking at the failure rather than in a document they would have had to read first. It is
printed for every such red, so it is sometimes beside a failure it has nothing to do with; that is
the accepted price of it being there for the one it does.
