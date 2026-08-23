# ah-brgo.2 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-23
- **PR:** #580

## The plan asked for a ruler-label test that `packages/shared` cannot run

**What happened.** Increment 2 named `renders_the_folded_label_on_both_edges_of_both_rulers` in
`packages/shared/src/workspace/MapCanvas.test.tsx`, asserting on the rendered ruler markup. The
rulers render nothing there: `MapCanvas.tsx:297` holds `size` in state filled by a ResizeObserver
effect, so under `renderToStaticMarkup` it stays `{0,0}`, `ticksX`/`ticksY` short-circuit to `[]`,
and there are no `<text>` nodes at all to assert on.
**Why.** The `ah-nass` trap — no jsdom in `packages/shared`, so component tests there run no
effects. The plan knew the trap (it cites `ah-nass` and uses it to justify increments 3 and 4 being
smoke tests) but still classed the ruler labels as "markup", which they are only once something has
measured the canvas.
**Cost.** About ten minutes, and one deviation to justify in the PR body. No CI cycle: it was caught
before the first push, by reading the component rather than by a red run.
**Prevent by.** When `plan-bead` places a test in `packages/shared/*.test.tsx`, the check is not
"is the thing markup?" but "is the markup reachable without an effect having run?" — anything gated
on a measured size, a ref or a store write is not. `packages/shared/src/testing/README.md` is the
place to say so, beside the existing pattern. The four ruler text nodes are covered in
`tests/smoke/workspace.spec.ts` instead, reading each edge separately.
**Seen before.** `ah-nass.md`, which established the rule; four beads are recorded in
`.claude/cerebro-traps.md` as having paid for it. This is the variant where the plan cites the trap
and lands on the wrong side of it anyway.
