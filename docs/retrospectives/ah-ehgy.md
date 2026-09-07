# ah-ehgy — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-07
- **PR:** #1033 (the reopened pass; the original was #1031)

## The plan decided how a row reads without saying which of the two sources shows it

**What happened.** `ah-ehgy` shipped, was verified by hand, and failed: a walker still read as
inside the fort it left behind. The verdict named a cause — "`arrived.structure_id` from
`move_destination` does not reach the screen", pointing at `effects.rs`'s arriving-row branch. It
was wrong. I reproduced the navigator's exact case first
(`preview_orders_for_remembered_report` over `G7_F62_T18` with `unit 916\nMOVE N`, printing every
row for 916) and the core was already correct: the arriving row came back `structure None` with the
change `structureId, was 7, cause MOVE N`. What fails is that
`mergePreviewAcross` **drops every `arriving` row by design** (`ah-tguk`, one row per unit across
hexes), so `All my units` shows the *departing* row, which stands in the origin hex with the origin
structure. The plan's decision **Q1** — three mockups, discussed with the navigator, chosen — was
written entirely about the arriving row's popup, and said in as many words "the departing row still
shows the fort with no change". Both halves are true; together they mean the surface the navigator
was reading was never covered.

**Why.** Established. Q1 reasoned about the destination hex's view (`mergePreview`, the `This hex`
source) and the bead's *Validation* asks the verifier to "write `MOVE <a direction>` for a unit
inside a fort" without naming a source. There are two, they show a mover differently on purpose, and
nothing in the plan says which one the decision is about.

**Cost.** One whole implementation pass and one verification pass wasted on a bead whose core was
already right, plus about 25 minutes of this pass establishing that before writing any code — and a
user-facing decision that had to be re-put to the navigator mid-implementation, which is the thing
the plan/build split exists to avoid.

**Prevent by.** Two things, both specific.

1. **`plan-bead`: a decision about how a moving unit's row reads must name the source.** Where a
   plan settles what a row shows for a unit that moves, it should say `This hex`, `All my units`, or
   both, and — where it means both — say what the row shows in the source that keeps only one of the
   pair. The fact it needs is one line in `unitPreview.ts`: `mergePreviewAcross` drops `arriving`.
   Worth a `.cerebro/traps.md` entry, since it has now cost a full cycle.
2. **`atlantis-verification`: the script for a movement-preview bead should name the source.** This
   bead's *Checks only a person can make* would have passed under `This hex` and failed under
   `All my units` with the same words, which is exactly what happened.

**Seen before.** `docs/retrospectives/ah-tguk.md` — same module, same author, and the same shape of
error one layer down: a plan holding a true fact about `mergePreviewAcross` and pointing it at the
wrong place. There the fact was aimed at the return value rather than the dependency array; here at
the arriving row rather than the source that drops it.
