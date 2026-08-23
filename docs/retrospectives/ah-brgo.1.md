# ah-brgo.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #579

## A plan that moves the camera moves the only real DOM the map has

**What happened.** The plan's design folded the map's translation into the first repeat after every
pan (`tx` into `[0, period)`), with the world drawn once and `<use>` copies either side. Built
exactly as written, `pnpm run test:smoke tests/smoke/workspace.spec.ts --project=web` went from
green to three failures — `a note pinned on the map opens its tags and selects the hex` and
`a planned route can be written into the unit's orders` among them — all of them clicks on real
elements timing out.
**Why.** Established. The world is drawn once, so the hexes, note pins and rings are the only real
DOM the map has; the copies are shadow-tree clones with no elements of their own. Folding the camera
therefore moves what the player is looking at from the real world onto a clone, leaving the real
elements a whole world off screen — out of reach of a click, of the keyboard, and of every existing
test that addresses a hex by its accessible name. This fixture's own opening fit sits past half a
repeat, so it was the ordinary case, not an edge one. Moving the copies to the repeats around the
camera instead (`ghostShift`) gives the same coverage and keeps what is on screen the thing it
appears to be.
**Cost.** About an hour, and four full runs of the web smoke suite (~6 minutes each) — one of them
spent establishing that a fourth failure, `the faction view uses the window before it scrolls`, fails
identically on `origin/main` and was nothing to do with the change.
**Prevent by.** A plan that moves the camera over cloned content should say which elements stay
real, and `plan-bead` should treat "the visible copy is not the element" as a question to answer
before choosing the mechanism. A cheaper check for the next implementer: after any change to how the
map view is positioned, run the two named tests above before the rest of the suite — both click a
real element rather than the fog, and they fail within a minute.
**Seen before.** None found.

## A `pointer-events` attribute inside a `<use>` beats the one on the `<use>` itself

**What happened.** The ghost copies carry `pointerEvents="none"` so a click falls through to the
full-canvas hit rect, which is what makes a click on a copy select the hex it is a copy of. The hex
polygons, note pins and note tag group inside the world set `pointerEvents="all"` as an attribute of
their own, and those clones went on taking clicks — Playwright reported the copy as intercepting
pointer events for an element it had already resolved.
**Why.** Established. `pointer-events` on a `<use>` is *inherited* by the cloned content, and an
inherited value loses to a value the cloned element specifies for itself. The fix is a custom
property: those three now read `pointer-events: var(--map-hit, all)` and a ghost sets
`--map-hit: none`, which inherits into the shadow tree and is what the clone resolves against.
**Cost.** Two web smoke runs and about twenty minutes, on top of the finding above.
**Prevent by.** `cerebro-traps.md` has no entry for `<use>`; this is the one fact worth having there
if the map grows any more cloned content — inheriting `pointer-events: none` into a `<use>` does not
disable clones that set the property themselves.
**Seen before.** None found.
