# ah-8zbc

## A smoke test pinned a text wrap that only macOS's fonts produce

**What happened.** The new test "at the smallest panel a row of three lines or more shows two and
scrolls" dragged the right rail to 15rem. Measured locally, the acceptance row wraps to four lines
there. On CI, the same row wrapped to two lines (33px), so the test failed in both smoke projects,
in an otherwise green run.

**Why.** CI's Linux runners draw the pane's sans-serif in a different font from macOS, with
different widths. The rail width had been tuned against local measurements to sit between two
behaviours: the status line still on one line, the row past two lines. That window does not exist
under the other font.

**Cost.** One full CI cycle (about 35 minutes, most of it queue) and a fix attempt.

**Prevent by.** A smoke test that needs text to wrap, or not to, sets the width at an extreme that
holds under any font: here, the rail's 12rem floor. It asserts the wrap it relies on, rather than
deriving a width from a local measurement. A sentence in `.claude/skills/produce-bead`'s test-plan
guidance, or a trap in `.cerebro/traps.md`, would carry it.

**Seen before.** Not as such. ah-46p.2 and ah-i984 are near: geometry read from something other than
the real app on the real runner.

## A unit test guarding the layout budget held a stale measured number

**What happened.** `panelLayout.test.ts` pinned the 1280x720 right column at 249px, from a 73px
header. The header measures 37px today, and the column 285px. The bead's 7px floor increase looked
as though it broke the budget (253 > 249) until the app was re-measured.

**Why.** The test hard-codes a figure "measured from the running application". Nothing re-measures
it when the header changes, so it drifts silently in the safe direction.

**Cost.** About ten minutes of probing before the plan could be written. Close to a needless
hand-back to UX.

**Prevent by.** A smoke test that measures the header and column at the pinned viewport, and
compares them with the constants `panelLayout.test.ts` uses, so the measured figure fails loudly
when it goes stale.

**Seen before.** ah-csni, a taller header surfacing in a drag test; this is the opposite drift.
