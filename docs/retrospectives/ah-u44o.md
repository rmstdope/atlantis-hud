# ah-u44o — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** #506

## Adding a chord to `SHORTCUTS` fails the unit suite until a second, unrelated table is updated too

**What happened.** The plan's *Files to change* section named `shortcuts.ts`, the palette action's
home and the dialog's owner, and its *Known traps* warned specifically about `SHORTCUTS` — "add the
chord to `SHORTCUTS`, not just to `matchShortcut`", because the help overlay reads the table. All of
that was done, and both smoke and the shortcut unit tests were green. `pnpm run check:fast` then
failed its `test` leg on a file nothing had pointed at:

    packages/shared/src/navigationGuide.test.ts
    × NAVIGATION_MOVES > spells the global chords exactly as the dispatch table does
      → no move for the gameData shortcut: expected undefined to be defined

**Why.** There are *two* tables behind the help overlay, not one. `SHORTCUTS`
(`packages/shared/src/shortcuts.ts`) holds the chords; `NAVIGATION_MOVES`
(`packages/shared/src/navigationGuide.ts`) holds the guide's prose entries and reads its keys back
out of `SHORTCUTS` via `chord(id)`. A test pins that every global chord has a matching move, so a new
id in the first table is a hard failure until it is added to the second. The plan's trap list
describes the coupling it knew about (`matchShortcut` → `SHORTCUTS`) and is silent about this one,
which reads as reassurance that `SHORTCUTS` was the whole story.

**Cost.** Small — one failed `check:fast` leg and roughly five minutes to read the failure and add
four lines. It is recorded not for its cost this time but because it is mechanical and certain: every
future bead that adds a keyboard shortcut hits exactly this, and the failure names a file the plan
never mentioned.

**Prevent by.** A planner writing a bead that adds a shortcut should name `navigationGuide.ts`
alongside `shortcuts.ts` in *Files to change*, and its trap list should say that the two tables are
tied by a test rather than only that `SHORTCUTS` must be updated. The one-line version worth
carrying: **a new `ShortcutId` needs a row in `SHORTCUTS` and a move in `NAVIGATION_MOVES`, and the
suite enforces both.**

**Seen before.** None found — `grep -rl "NAVIGATION_MOVES\|navigationGuide\|SHORTCUTS"
docs/retrospectives/` returned nothing.
