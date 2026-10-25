# ah-koleq — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-25
- **PR:** #1885

## A narrow-window wrap test passed on macOS and failed on CI, because CI's fonts fit the line

**What happened.** `tests/smoke/orders-export-warning.spec.ts`, "on a narrow window Cancel and Export anyway wrap together", resized to 340px and asserted that Cancel sits on a line below Show errors. It passed locally (including `--repeat-each`) and failed in `smoke (web, 2, 4)` at `expect(cancel.y).toBeGreaterThan(show.y + show.height - 1)`: on CI all three buttons fitted on one line, so nothing wrapped. Fixed by asserting at 300px, where three buttons cannot share a line in either font while the pair still can, and polling the geometry after the resize.

**Why.** Established in outline, not measured: CI's Linux runners draw the buttons in a narrower face than macOS, so the width at which the row wraps differs between the two. A width picked by running the test locally sits on macOS's wrap point, not on a point that holds in both.

**Cost.** One CI cycle (about 8 minutes) and one of the bead's three fix attempts.

**Prevent by.** A test that asserts a wrap (or a fit) should pick its width from both faces' worst case, not from a local pass. For example, `tests/smoke/gameSetup.ts` could expose a helper that sets a width and first asserts the premise (the row's natural one-line width exceeds the available width), so a font that fits fails as "premise not met" rather than as a layout regression. This is the fourth such case, so it may be ready to become an entry in `.cerebro/traps.md`.

**Seen before.** ah-8zbc (a wrap pinned that only macOS's fonts produce), ah-14xq (a rem width measured on macOS), ah-j92v (the macOS-vs-Linux face).
