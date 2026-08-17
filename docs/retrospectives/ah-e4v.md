# ah-e4v — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #400

## The RED test passed against the broken build

**What happened.** The plan's test plan specified the proof as a comparison of bounding boxes: the
popup's width greater than the editor's, and its right edge beyond the editor's right edge. Written
exactly as specified and run against unmodified `main`, it passed — 4 passed, first try — for a
defect the navigator had just seen with their own eyes.

**Why.** Established. An ancestor's `overflow-hidden` clips what is *painted*; it does not change the
clipped element's own `getBoundingClientRect`. A popup rendered inside the editor and cut off at its
edge still reports its full, un-clipped box to `boundingBox()`, so both assertions were true while the
reader could see none of it. The test measured that there was something to clip, not that it survived
clipping. The replacement hit-tests instead — `document.elementFromPoint` at a point inside the popup
but past the editor's right edge — which is false both when the popup is clipped away and when it is
painted under the pane it is meant to overhang, and so happens to cover the plan's z-index trap too.

**Cost.** About one smoke cycle, ten minutes. Cheap only because the test was run against the broken
build before the fix went in; had the plan's two edits been applied first, the test would have gone
green immediately and the bead would have merged with a test that proves nothing and a defect that
might or might not have been fixed.

**Prevent by.** Two things, both for whoever writes the next plan of this shape. Where a bead is about
what the reader can *see* — clipping, occlusion, layering, z-index — the test plan should name a
hit-test or a screenshot rather than a geometry comparison, because CSS geometry survives every one of
those defects intact. And a plan whose single increment is "RED: this test, which fails today" is
worth one line saying it was actually observed failing, since here it did not.

**Seen before.** none found. `ah-t2i` used `elementFromPoint` for diagnosis and `ah-46p.2` records a
smoke assertion that measured an element it should not have, but neither is this.

## Not recorded: GitHub's API was 503 for about ten minutes

Noted only to say it was judged and dismissed. `gh pr create`, `--add-reviewer`, the reply and the
thread resolution each failed several times with HTTP 503 mid-run; retry loops absorbed all of it and
nothing was lost. Transient upstream weather, no action available to anyone here.
