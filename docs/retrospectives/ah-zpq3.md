# ah-zpq3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-08
- **PR:** #1051

## The plan's opening test asked for something the static renderer cannot see

**What happened.** Increment 4's opening test was to render `StudyPlannerDialog` and assert the
warnings strip lost `outside any building`. It cannot: the strip renders only in the dialog's
**Schedule** view, which is `useState`, and `packages/shared` renders with `renderToStaticMarkup`,
which never leaves the default `All mages` tab. The written test failed on its *baseline*
assertion — the markup contained no warning at all, with or without the fix — which reads like a
broken fix rather than an unreachable surface. The equivalent test went to
`workspace/StudySchedule.test.tsx` instead.
**Why.** `.cerebro/traps.md` warns that this package's component tests run no effects and fire no
timers, and the plan quoted that trap — but the trap is about *effects*, and this was about a
surface behind **component state a static render cannot reach**. A plan can satisfy the trap as
written and still name an unrenderable assertion.
**Cost.** About fifteen minutes, and one confusing red before the cause was clear.
**Prevent by.** Extending the `packages/shared` trap (`.cerebro/traps.md`, and `plan-bead`'s use of
it) from "runs no effects" to "renders only the component's initial state": a plan naming a
`*.test.tsx` there must assert something visible in the **default** view, or name the presentational
component that draws it directly.
**Seen before.** None found — `grep` over `docs/retrospectives/` for the component-state phrasing
returns nothing; the four beads the trap names are all the effects half of it.
