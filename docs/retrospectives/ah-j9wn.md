# ah-j9wn — retrospective

**Bead:** Reshape magic study plans by inserting or removing a turn (PR #1166)
**Session:** Cyclops, 2026-09-11

## What went wrong, and what it cost

**A TDZ crash only a real browser found.** `ScheduleConfirmLayer` called
`useEscapeToDismiss(back)` above `const back = () => …`, a reference to a `const` before
initialization. Static `renderToStaticMarkup` tests cannot catch it (no effects run), and the
production build does not fail on it: the app built, loaded, and rendered the whole schedule —
the crash came only when the dialog actually mounted, took the React tree down with it
(`Cannot access 'i' before initialization`, blank root), and presented in the smoke run as
"dialog never opens".

Cost: two full smoke cycles plus a sourcemap build to localize the minified frame. The sourcemap
read (`vite build --sourcemap` then find the frame in the generated file) took one command and
named the function and the offending line immediately — that step is worth doing first, before
reading the source looking for anything plausible.

**A test expectation written against the wrong arithmetic.** The smoke test's insert step was
written as if the FORC goal still sat at turn 74, but the remove step just before it had already
pulled it to 73, so "insert before 74 leaves 73 empty" could never hold. The app was correct. The
fixed step inserts before 73, which also round-trips the removal — a stronger test than the one
planned.

**The bead grew by five pre-existing smoke failures.** Five study-planner smoke tests have been
red on main since 2026-09-10, when a same-day series of style commits (heading chip, removed
`Held back` list, persistent fill on the chosen row) changed the UI without following its browser
tests. CI's smoke jobs were red on every run since, which also meant the "every check is green"
merge condition was unverifiable on any PR touching this area. The navigator chose to fix them on
this PR.

## What is worth keeping

- `renderToStaticMarkup` suites do not execute effects, so any `const` referenced by an effect or
  a hook call in a layer component is untested until a browser runs it. The sourcemap read is the
  cheap way to find where a minified page error lives.
- When a test fails and the received value looks *sensible*, check the test's own arithmetic
  against the steps above it before suspecting the app.

## Follow-ups

- The style pass that broke the tests was merged without its browser suite; nothing caught it
  because the smoke suites only run in CI and its failure never blocked a merge there.
- One Review of record: findings 1 (focus trap) and 4 (split the smoke test) were declined; both
  are recorded on the PR.