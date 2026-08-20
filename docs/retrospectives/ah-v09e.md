# ah-v09e — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-19
- **PR:** #435

## A one-step type increase cascaded into fourteen smoke failures across four unrelated mechanisms

**What happened.** The plan anticipated smoke breakage and said so ("the browser suites will fail,
and that is expected... update the assertions to the new truth"). What it did not anticipate is that
most of the breakage would not be assertions at all. Of the failures the type-scale increment
caused, only one was a stale expectation. The rest were defects:

- A `<tr>`'s `height` is a *minimum*, so rows rendered 22.875px against a `ROW_HEIGHT` of 22 that
  the windowing arithmetic divides by. Fixed at the source (22 → 24).
- Raising the units pane's default height to keep its documented "twelve rows" then took 26px from
  the right-hand column, which at a 720px window squeezed it until folded panels' own title bars
  stopped taking clicks, and left the drag ceiling 56px above the default. Reverted; the pane now
  shows eleven and a half rows.
- Taller rows meant two fewer rendered in a windowed table, so a text assertion on the nineteenth
  unit of a hex stopped finding it. That one was a genuinely stale assertion, fixed by asking the
  filter instead of the rendered window.
- A pre-existing stacking bug surfaced: `LayerChips` carries `backdrop-blur`, which opens a
  stacking context, so an open menu's `z-20` could never lift it over the panel column. Nothing
  overlapped until the panes grew.

**Why.** Established. The type scale is not a local change: it feeds row heights, pane heights,
menu heights and therefore the geometry of every overlay, and this repository's smoke suite is
dense enough to detect all of it. The plan's *Known traps* correctly said "type metrics move" but
framed the consequence as assertions needing updating, which set the wrong expectation for triage —
I twice reached for the assertion before checking whether the product was actually wrong.

**Cost.** About four hours of wall clock, six full or partial browser-suite runs, and one fix
(unconditional `z-30`) that traded four failures for twelve before being narrowed to a conditional
lift. One of those runs took 1.2h rather than the usual 13m because another implementer's suite was
contending for the same serializing gate lock.

**Prevent by.** A plan that changes a type scale, a row height or a pane's default size should say
in *Known traps* that **the first question about a browser failure is whether the product is wrong,
not the assertion** — the default assumption in the current wording is the opposite. Concretely,
this bead's §4 could have named the three constants that are derived from type metrics
(`ROW_HEIGHT` in `unitTable.ts`, `UNITS_DEFAULT_REM`/`UNITS_MIN_REM` in `workspace/panelLayout.ts`)
and asked for them to be re-derived as part of the increment rather than discovered by failure.

**Seen before.** ah-2r3 — "A bigger default units pane pushed the map's initial fit out a zoom tier,
breaking two unrelated smoke tests": the same constant, the same class of knock-on, and the direct
reason I reverted the default height here rather than chasing its consequences. ah-1uj —
"Several beads landing header chips in quick succession broke pixel-exact smoke tests that had never
failed before" is the same mechanism from a different direction. This is the third sighting of
"workspace geometry is a shared global that smoke tests pin from many angles".

## A planner's mid-build correction arrived after I had already found half of it independently

**What happened.** Xavier amended the plan while I was building, correcting two token values and
widening the new test to cover accents. I had already found one of those two tokens failing — by a
different constraint (`#8d99a8` at 4.47:1 on the opaque raised panel, which the existing nine-pair
test catches) than the one Xavier found (4.07:1 through a pane over tundra).

**Why.** The plan's §1 table recorded each token's ratio on the panel only, and `panel-raised` is
the lightest of the three dark surfaces and therefore the worst case for light text. A table with
one surface column cannot show that.

**Cost.** None — the correction and my own fix converged on compatible values, and the exchange took
two messages. Recorded because it went *well*: the mid-build message cost far less than a hand-back
would have, and it is evidence that an interactive planner talking to an interactive implementer is
worth the turn of context it costs.

**Prevent by.** A palette table in a plan should carry one column per surface the token can be drawn
on, not one for the representative surface. Xavier confirmed `ah-j1xd` already asserts every text
token against all three surfaces in both themes.

**Seen before.** None found.
