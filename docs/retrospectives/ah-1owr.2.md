# ah-1owr.2 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #451

## A drag handle rendered correctly, and no pointer could ever reach it

**What happened.** The plan specified the resize handle as absolutely positioned inside its header
cell, overhanging the boundary at `-right-1.5` — the arrangement PR #421's branch used and the one
`RailSplitter` uses. It rendered: the separator was in the accessibility snapshot, correctly
labelled, with the right geometry. The smoke drag moved nothing at all, twice, with the column
width identical before and after. `document.elementFromPoint` at the grip's own centre returned the
**neighbouring `<th>`**, not the grip.

**Why.** Established. Every header cell is `sticky top-0 z-10`, so each one is its own stacking
context. A handle overhanging into the next cell is trapped inside its own cell's context, and the
next cell — later in the DOM, same z-index — paints its opaque `bg-panel` over it. `RailSplitter`
does not hit this because its neighbours are not positioned siblings at equal z. The fix is one
class: `right-0`, keeping the handle inside its own cell.

**Cost.** About 35 minutes and three targeted smoke runs, of which two were spent assuming the
handler was wrong (missing ref, bailed measurement) rather than the hit test.

**Prevent by.** When a plan places an interactive element by absolute positioning so that it
overhangs a sibling, its *Known traps* should say to check the hit test, not only the render — and
the check is one line, `document.elementFromPoint(x, y)` at the element's own centre in a smoke
debug run. A unit test rendering to static markup cannot see any of this, and "the separator is in
the snapshot" reads as working when it is not.

**Seen before.** ah-v09e and ah-etb0.2 — both the same underlying rule (a positioned element with a
z-index traps its children in a stacking context they cannot escape), both found through the browser
suite rather than reasoning. This is its third sighting, and the first where the symptom was a dead
pointer rather than a wrong paint order.

## A 24px column silently swallowed an existing control's clicks

**What happened.** The plan said a handle goes at every internal boundary. The `own` column is 24px
wide and its header holds the group-own-units toggle; a 12px grip pinned to its right edge covers
half the cell and takes the toggle's clicks. Nothing in the new tests noticed — it was the existing
`the ownership toggle releases the own-units-first grouping` smoke case, in the full run after
`check:fast` was already green, that failed.

**Why.** Established, and it is the same hit-test blind spot as above: static-markup tests assert
what exists, never what is on top of what.

**Cost.** One full 13-minute local smoke run, which is what the run is for; no CI cycle, because it
was caught before the PR opened.

**Prevent by.** A plan that adds an overlay to *every* member of a list should say which members are
too small to carry one, or state the minimum size the overlay needs. Here `own` is 24px against a
12px grip and a control already in the cell — a fact available at planning time from
`COLUMN_WIDTHS`.

**Seen before.** ah-etb0.2 names the same shape from the other end: a shared strip where one added
control broke two unrelated smoke tests. None found for the specific "overlay lands on an existing
control" case.
