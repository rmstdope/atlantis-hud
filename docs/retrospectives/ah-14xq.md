# ah-14xq — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-20
- **PR:** #1828

## A fixed "just below the switch point" width was below it on macOS and above it in CI

**What happened.** The smoke test `just below the default width the planner buttons sit on their own
row, and pressing Plan move moves nothing` dragged the right rail to a fixed 20rem, which is below
the width the widest title-line state needs. It passed locally on macOS. On CI, `smoke (web, 2, 2)`
failed in `expectButtonRow`: the buttons were still on the title line, because at 20rem the header
held the widest state on one line.

**Why.** Established. The title line is set in the monospace stack, which is a different font on the
Linux runner, and there the widest state fits at 20rem. The plan wrote the switch point down as a
number in rem that had been measured on macOS. It was a property of the font, not of the layout.

**Cost.** One red CI cycle (about 12 minutes) and one of the bead's three fix attempts. The fix was
to measure the width the widest state needs in the page and drag the rail 3px short of it.

**Prevent by.** A smoke test that places a layout on one side of a content-driven breakpoint derives
the breakpoint from the page (as `widestTitleLine` in `tests/smoke/workspace.spec.ts` now does),
never from a width measured on one machine. This is the same trap ah-j92v proposed for
`.cerebro/traps.md` (glyph widths differ between the macOS and CI Linux faces), and a third
occurrence is the case for adding it.

**Seen before.** ah-j92v (a glyph box sized from a macOS measurement), ah-txyp (row wrapping differs
on CI's fonts), ah-0unf (sub-pixel ratio on Linux metrics).
