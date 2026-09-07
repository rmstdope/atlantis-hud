# ah-coij — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-07
- **PR:** #1037

## A shell callback that loads several reports in one action met the render-behind trap three times

**What happened.** This bead is the first thing in the app that calls `loadReport` several times
inside one action: Fetch brings this turn's report and then every earlier turn the world holds. Three
separate values read from the render were stale for exactly that window, and each produced a
different visible defect:

- `routeReport(parsed, …)` — the second report was routed against what was on screen *before* the
  first, so an earlier turn that should have been stored took the screen. Caught by the bulk smoke
  walk ending on turn 71 rather than 72.
- `workingTurn` for `missingTurns` — the plan's named trap ("the turn just fetched must not be
  fetched again") held only because two awaits happened to give React time to re-render.
- `factionId` for the end-of-run turn-picker refresh — `null` on a first fetch of a fresh game, so
  every turn a bulk run stored was left out of the picker. Nothing caught this until a review
  finding forced a Cancel walk to be written.

**Why.** Established, and it is the shape `ah-6yj2` already recorded: a value that lives in React
state is behind for the whole of an `await` inside a callback, and a ref *assigned during render* is
a mirror of that state and is behind with it. The fix that works is the one that retrospective
names — the value travels with the event rather than being read back from a render. Here that is
`viewerRef`, set the moment `applyReport` reports the turn actually reached the screen.

**Cost.** About 90 minutes across the build and two review rounds, and three of the seven findings in
the first review were this one cause wearing different clothes.

**Prevent by.** A plan whose action performs a *loop* of anything that changes what is on screen
should say so, and should name where each per-iteration input comes from. `ah-6yj2`'s **Prevent by**
already asks an implementer to check this when a plan says "read the latest value through a ref";
what this run adds is that the question is worth asking even when the plan says nothing about refs
at all — the trigger is "several of these in one action", not the word `ref`.

**Seen before.** `ah-6yj2` — same cause, same fix, and its own note records a second instance in one
run. This is at least the third sighting.

## Three review rounds on one test, because "it passes" was mistaken for "it would fail"

**What happened.** A review finding asked for the plan's missing Cancel walk. Its negative assertion —
*nothing claims the run finished* — was wrong three times running, and each fix was reviewed and
found wrong again:

1. `not.toContainText("stored for history;")` — that string is `loadReport`'s line for the one turn
   that *did* land, so it asserted nothing.
2. `not.toContainText("turns stored for history")` — `runSummary` pluralises by count and exactly one
   turn lands, so the regression would have written the singular and passed.
3. `toHaveText("turn 70 stored for history; …")` — `toHaveText` polls until it matches at *some*
   moment, and the regression transiently produces exactly that text before overwriting it.

Only the fourth form — counting the history requests the run actually issued — cannot be satisfied in
passing.

**Why.** Established. Each of the first three was written, run, seen green, and reported as fixed.
Green says a test passes against the code as it is; it says nothing about whether it would fail
against the code as it was. For a *negative* assertion about an asynchronous run those two are
routinely different, and all three shapes of the mistake — wrong string, wrong plurality, right
string at the wrong moment — are invisible to a passing run.

**Cost.** Three review rounds, about 25 minutes, and two PR comments claiming a property that had not
been checked.

**Prevent by.** Before reporting a regression test as fixed, *inject the regression and watch the
test fail*, then restore. On the fourth round this took one edit and one 16-second run
(`pnpm run test:smoke -- --project=desktop-shell tests/smoke/newage-fetch.spec.ts -g "cancelled"`
with `runHistoryFetch`'s loop-top `abandoned()` check removed) and would have ended the sequence at
round one. This is cheap enough to be the rule for any test whose assertion is a negative.

**Seen before.** `ah-3pr9` and `ah-f9q9` both record `toHaveText` resolving against the value the
walk was waiting to see replaced — the same "a poll matched a moment" failure, in the opposite
direction. None of the three names injecting the regression as the check.
