# ah-mwqa — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-20
- **PR:** #486

## The plan put effect-level tests in a file whose harness runs no effects

**What happened.** The plan's increments 3, 5, 6 and 7 named `MapCanvas.test.tsx` and
`FactionDossierPanel.test.tsx` for the peek/restore behaviour, the once-per-hover-run capture, the
cancels and the debounce. Neither can test any of that: `packages/shared` has no jsdom, its
component tests are `renderToStaticMarkup` (no effects run), and `FactionDossierPanel.test.tsx`
exercises a row by calling the component *as a plain function* through its `findByTestId` walker.
The first attempt followed the plan literally and added a `useLayoutEffect` to
`FactionDossierPanel` to report its rectangle — which turned all nine of that file's existing tests
red at once with an invalid-hook error that names neither the walker nor the cause.

**Why.** The plan's own *test plan* section states the constraint ("this package has no jsdom",
"call its own prop") and then assigns tests that need the opposite. The constraint was known and
was not carried through to the increment list.

**Cost.** About 30 minutes: one wrong shape of the panel change, a confusing red, and a redesign of
where the rule lives — extracted into a pure `peekStep` in `dossierPeek.ts` and reported upward
through a `useReportedRect` hook and a `MeasuredFactionDossier` wrapper, so the panel stays
hook-free. The end state is better than what was planned, so the cost was the detour, not the
design.

**Prevent by.** A plan for `packages/shared` should route any behaviour that needs an effect,
a ref or a timer into a pure module and name *that* file in the increment list. Concretely: when a
plan names an existing `*.test.tsx` in this package for anything other than markup or a prop call,
that is the moment to check it against the file's own harness. The rule "a rule written inside a
component is a rule no test can read" is already written in `tradeArrow.ts`'s header — plans could
cite it as the pattern rather than restating the constraint and then departing from it.

**Seen before.** `ah-t2i` and `ah-o1t.2` both record the same package's testing constraints biting
mid-build (`ah-o1t.2`: `renderToStaticMarkup` cannot see store state); `ah-cgk` records a plan
citing a test pattern that does not exist here. This is the third bead to pay for the gap between
what a plan assumes about this package's tests and what they can do.

## The planned geometry rule moved the map by zero pixels, and only smoke said so

**What happened.** The plan specified `keepClearInsets` as treating the panel "as reaching in from
whichever edge it reaches furthest into", and the whole feature is built on it. Implemented as
written — and then as the *shallowest* reach, which reads more sensibly — the map never moved at
all: with the real geometry (a 320px column, `left 305 … right 625`, on a 1280×647 host) the
shallowest edge is `top` at 590px, which reserves all but a 57px strip, falls through
`visibleRect`'s `MIN_VISIBLE` fallback to the whole canvas, and leaves the hex reading as visible.
Every unit test passed throughout: the fixtures I had chosen were square-ish hosts where depth and
area agree. The failure was only visible from a smoke run that printed the panel rect, the host
rect and the ring's position.

**Why.** The rule needs to weigh each reach by the span it eats (`depth × height` for a side,
`depth × width` for a top or bottom), because the cheapest edge and the shallowest edge differ
exactly when the panel is a tall column on a wide host — which is the only shape the dossier ever
has.

**Cost.** Two smoke runs and about 25 minutes, most of it spent proving the wiring was correct
before suspecting the arithmetic.

**Prevent by.** When a plan hands over an approximation in prose ("whichever edge it reaches
furthest into"), the first unit test should use the **measured** geometry of the real thing rather
than an invented one — `dossierPeek.test.ts` now pins the 1280×647 case by name. For a plan, the
cheap version of the same protection is to state the real numbers it expects the rule to face.

**Seen before.** None found.
