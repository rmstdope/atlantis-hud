# ah-1mpx.4 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-28
- **PR:** #764

## Three drag walks passed on macOS and failed on CI, because the browser was dragging the text

**What happened.** The bead's three pointer-drag walks in `tests/smoke/armies.spec.ts` passed here
against both shells and failed on CI against both shells, deterministically and through the retry,
always at the same assertion: `getByTestId("unit-drag-chip")` never appeared. Two things made it
look like a geometry problem and it was not. CI's own `error-context.md` showed the pick standing
untouched at `2 units picked.` with no chip, which reads as "the press missed the row"; rewriting
the helper to press with `hover()` instead of a hand-computed offset changed nothing. The trace
(`gh run download`, then the `0-trace.trace` JSONL) is what settled it: in the one walk that drags
twice, both drags issue an identical action sequence and only the second fails.

**Why.** Established. A `Shift`+click extends the *document's text selection* as well as the pick,
so the next press lands inside selected text — and a press on selected text followed by a move is
how a browser begins dragging that text, which cancels the pointer stream the drag is built on.
`ColumnReorderHandle` never meets this because it calls `preventDefault()` on its own pointerdown; a
unit row cannot, because it must still take focus for the roving `tabIndex`. `onDragStart` refusing
the browser's drag on the `<tr>` is the fix, and CI went green on it. It is an application defect,
not a test one: a player who shift-picks a run and then drags it would have hit exactly this.

**Cost.** Two CI cycles and about 50 minutes, one of them spent on a rewrite (`hover()`) that fixed
nothing.

**Prevent by.** Naming it in `.cerebro/traps.md`, since nothing in the repository says it and the
next pointer-drag on selectable content will meet it too: *a pointer drag that begins on selectable
content must refuse the browser's own drag — `preventDefault()` on pointerdown where the element
need not take focus, `onDragStart` where it must. Chromium starts a native text drag from an
existing selection, which fires `pointercancel` and kills the gesture; whether a selection is
standing depends on what the previous click did, so it reproduces on one machine and not another.*
Worth adding to `plan-bead`'s trap list for any bead whose plan says "drag" over rows or text.

**Seen before.** None found — `grep -rl "dragstart\|native drag\|text selection" docs/retrospectives/`
matches nothing. Local-green/CI-red has its own history here (`ah-j2w`, `ah-gjq4`, `ah-djq`,
`ah-6yj2`), but none of those is this cause.
