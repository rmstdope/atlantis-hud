# ah-2r3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-15
- **PR:** #265

## A bigger default units pane pushed the map's initial fit out a zoom tier, breaking two unrelated smoke tests

**What happened.** `pnpm exec playwright test tests/smoke/workspace.spec.ts tests/smoke/settings.spec.ts`
failed on two pre-existing tests that never touch the units pane at all: "each badge can be turned
off on its own..." (settlement marks reported zero-size, hidden) and "the map under a folded panel
can be clicked" (no unselected hex fell inside the freed rectangle). Both passed unmodified against
`origin/main`.

**Why.** The plan's `unitsSlotClass` gives the units pane a fixed pinned height (`h-[20.625rem]`,
matching the orders editor's own precedent) whenever no custom height is stored — including before
any hex is ever selected, where the old code hugged content and stood only as tall as a short "No
hex selected." message. `MapCanvas`'s one-time initial fit runs at that exact moment, against
whatever the bottom `data-map-overlay="bottom"` inset measures then. With ~280px more of the window
reserved by default, the fit lands one zoom tier further out ("map-far" instead of "map-mid"),
which the map's own theme legitimately hides fine detail (settlement glyphs) at, and which visibly
shrinks how far hexes spread toward the screen edges. Neither failure is a defect in the units-pane
code itself — both are downstream of a real, approved trade-off (the mockup's "the dragged height is
the height" decision, generalised to the undragged default too) meeting a completely separate
subsystem (the map's one-shot fit-on-load) that nothing in the plan's test list anticipated.

**Cost.** About two hours: reproducing on `origin/main` in a scratch worktree to rule out
environment flakiness, instrumenting the failing tests in place to find that settlement `<g>`
elements were rendering with a real but collapsed (zero) bounding box, tracing that to the map's
`scale`/zoom tier rather than a broken transform, and then finding a fix that actually holds (zoom-in
alone moved the wrong hexes for the fold test — it anchors on canvas centre, which does not always
move the *needed* hex toward the freed corner; a direct pointer-drag pan of a known hex onto the
target point is what worked reliably).

**Prevent by.** When a bead changes a panel's *default* footprint (not just its draggable range),
the plan's validation section should say to run the smoke suites for any other feature that reads
live layout geometry — here, `MapCanvas`'s fit-to-view — rather than only the suites that mention the
panel by name. A one-line note in `plan-bead`'s template ("does this change the space anything is
reserved by default, before user interaction?") would have caught it before RED.

**Seen before.** None found.
