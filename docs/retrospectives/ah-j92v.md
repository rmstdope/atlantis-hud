# ah-j92v retrospective

## A box sized to "one `…` is exactly `1ch`" held on macOS and clipped the `…` in CI

**What happened.** The Silver figure's `…` was drawn inside the figure's clipping box, whose floor
is `min-w-[1ch]`. Measured locally, the table's monospace face (SF Mono on macOS) draws `…` at
7.8 px, exactly `1ch`. The plan recorded that as a fact, and the smoke helper asserted that the `…`
is never clipped. Every Silver smoke test passed locally on both projects. In CI, both shard-2 smoke
jobs failed: on the Linux runner the `…` glyph box is 13 px against a 12.08 px figure box at the
36 px floor.

**Why.** Established. `ui-monospace, "SF Mono", Menlo, Consolas, monospace` resolves to a different
face on the Linux runner, and there the `…`'s advance is wider than a digit's. "Monospaced, so every
glyph is `1ch`" holds for the face measured, not for the stack.

**Cost.** One red CI cycle (about 15 minutes), one fix attempt, and a third review round.

**Prevent by.** In a smoke test that asserts a glyph fits a box, never derive the box's size from a
glyph width measured on one machine. Either lay the glyph outside the clipping box (this bead's fix,
in `packages/shared/src/workspace/WholeFigure.tsx`), or assert the fit in CI before writing it into a
plan. A candidate for `.cerebro/traps.md`: *glyph widths differ between the macOS and the CI Linux
faces, even inside a monospace stack.*

**Seen before.** `ah-i984` measured widths from a mockup's fonts rather than the app's; `ah-zh5i.1`
covers a font-dependent assertion. This one is the macOS-vs-Linux face, which neither names.
