# ah-5g9 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #372

## The plan's own choice of pane for the new smoke walk did not exercise the insets path it was written to cover

**What happened.** The plan specified reflowing a pane by collapsing/reopening the region panel
(`[data-testid="panel-region"] header button`) after panning the map away from a selection, then
asserting the map transform did not change. Mutation-testing that walk — forcing the follow-selection
effect to always travel, simulating the pre-`64cb74f` regression — did **not** turn it red: the test
passed identically whether the guard was present or forced off, which meant it was not exercising the
mechanism it was supposed to pin.

**Why.** `overlayInsets` computes each edge's inset from a single dimension of that edge's box:
`left`/`right` from `box.right`/`box.left` (horizontal, x-position), `top`/`bottom` from
`box.bottom`/`box.top` (vertical, y-position). The region panel sits in `leftRailRef`, a
fixed-**width** rail (`data-map-overlay="left"`); collapsing it changes its **height**, which never
moves `box.right`, so the `left` inset never changes and the follow-selection effect never re-runs.
The units panel, by contrast, sits on `data-map-overlay="bottom"`; collapsing it moves `box.top`
vertically, which does move the `bottom` inset — that pane is what the original CI failure's mechanism
(a header reflow moving a vertical edge) actually resembles. Swapping to the units panel and
re-running the same mutation check confirmed a real red bar.

**Cost.** About 30 minutes: building `browser-core`'s wasm module (not needed for anything before
this point) to get a smoke run at all, one smoke run that passed suspiciously easily, tracing
`overlayInsets`'s per-edge arithmetic to see which dimension each edge actually reads, and one more
smoke run to confirm the swapped pane discriminates. No CI cycle was spent — caught locally, before
the PR opened.

**Prevent by.** When a plan names a specific pane/selector for an insets- or layout-geometry-driven
regression test, the increment's RED step should say explicitly which edge (`data-map-overlay="…"`)
that pane is anchored to and which dimension `overlayInsets` reads for that edge — not just "reflow a
pane". `overlayInsets`'s own doc comment already explains the per-edge arithmetic; a plan asking for
this class of test could point at it directly, the same way ah-2r3 found that a panel's *default*
footprint change needs the same live-geometry reasoning extended past the suites that mention the
panel by name.

**Seen before.** ah-2r3 — a different mistake in the same subsystem (`data-map-overlay`, the map's
measured insets), also caught only by actually running the browser suite rather than reasoning about
the layout in the abstract.
