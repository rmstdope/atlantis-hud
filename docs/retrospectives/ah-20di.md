# ah-20di — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-05
- **PR:** #977

## A sixth settings tab overflowed the dialog, and only the browser suite could see it

**What happened.** Adding the `Columns` tab made the settings dialog's tab strip wider than its
panel: `settings.spec.ts:464`'s existing `scrollWidth - clientWidth <= 1` assertion failed with 23.
`pnpm run check:fast` was green throughout — the strip is a layout the unit suites cannot measure,
since `packages/shared` renders with `renderToStaticMarkup`. The fix was one class, `flex-wrap`,
and the chosen mockup (`docs/ui/ah-20di-columns.html`) already showed the strip wrapped, so the
intended behaviour was on file; the code simply had `flex gap-1`.
**Why.** The plan named the wrapped strip as a consequence to be judged by a person at 200%
interface size, so it read as a look question rather than as something an existing assertion
already pinned. Nothing pointed at the assertion that would catch it.
**Cost.** One full local smoke run to discover it (23 minutes), and it would otherwise have been a
red CI cycle.
**Prevent by.** A plan that adds a tab, a button or a row to the settings dialog should name
`settings.spec.ts`'s panel-overflow assertion in its *Known traps*, the way this one named
`settings.spec.ts:391`. The dialog has a fixed width and a finite strip; anything widening either
is measured there and nowhere else.
**Seen before.** None found — no retrospective mentions the settings panel's overflow assertion.

## Moving a control between tabs breaks the smoke tests that click it, and the plan listed neither

**What happened.** The plan moved the two column reset buttons from the Global tab into the new
Columns tab. `workspace.spec.ts:2796` and `:2901` click those buttons after opening settings, so
both timed out waiting for a testid that is now one tab away. Each needed one added line.
**Why.** The plan's *Known traps* named the one settings smoke test it expected to be affected
(`settings.spec.ts:391`, which was in fact unaffected) but not the two in `workspace.spec.ts` that
actually click the moved controls — they are in a file about the workspace, not about settings.
**Cost.** Two failing specs in the same local smoke run as the finding above; about ten minutes
including the rerun.
**Prevent by.** When a plan moves a control, `grep -rn "<its testid>" tests/` and list every hit in
*Known traps*. The testid is the whole search, it takes a second, and it does not depend on
guessing which spec file a control belongs to.
**Seen before.** None found.
