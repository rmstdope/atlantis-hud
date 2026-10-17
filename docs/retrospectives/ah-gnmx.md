# ah-gnmx — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-17
- **PR:** #1701

## An upward Add to army list was cut off at the units dock's top edge

**What happened.** The plan kept the button-form list inside `ChipPopover`, absolutely positioned
under its chip, and only capped its height and flipped it upward. The smoke walk for the upward case
(`with too little room below for five rows the list opens upward`) placed the panel correctly by its
bounding box but failed `toBeInViewport()` on New Army…: the list was there and painted away.

**Why.** Established. `CollapsiblePanel` is `overflow-hidden` with `backdrop-blur`; the blur makes it
the containing block for absolute and fixed descendants, so nothing inside the dock can paint past
its edges. `UnitContextMenu.tsx`, `FloatingFactionDossier` and `UnitTooltip.tsx` each record this in
a comment, but nothing about a chip popover pointed at it, and the plan was written without it.

**Cost.** One smoke iteration plus a redesign mid-build: portalling the list and adding
`useChipPopoverAnchor` / a `panelRef` to `usePopoverDismiss` so the toggle, dismissal and focus
return still worked. About twenty minutes.

**Prevent by.** A `.cerebro/traps.md` entry: "Anything drawn from inside a `CollapsiblePanel` (the
units dock, the side panes) is clipped to that pane: it is `overflow-hidden` + `backdrop-blur`, so
`fixed` does not escape it either. A popover that must pass the pane's edges is portalled to the
body; `AddToArmyMenu` + `useChipPopoverAnchor` is the chip-anchored worked example."

**Seen before.** ah-e4v, ah-y9hx (an ancestor's `overflow-hidden` clipping what is painted).

## `npx prettier --write` reformatted whole files again

**What happened.** I ran `npx prettier --write` on the six files I had touched. The repository has
no Prettier, so npx used its defaults (80 columns, trailing commas) and reformatted every line.
When I re-ran it at width 100, it still re-wrapped existing lines in `tests/smoke/armies.spec.ts`,
which uses a wider width. I restored that file from HEAD and re-applied only my own edits.

**Why.** Established. No formatter is declared, and each file has its own width.

**Cost.** About ten minutes of diff inspection and restoring.

**Prevent by.** A `.cerebro/traps.md` entry saying the repository has no formatter and that
`npx prettier` must never be run on it, with the eight beads below as the count.

**Seen before.** ah-49is, ah-dbw4, ah-ezyg, ah-g9sf.7.1, ah-kv6c, ah-lbd9.4, ah-mw1r.3, ah-t8c4.
