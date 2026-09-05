# ah-vxlx — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-05
- **PR:** #988

## The plan's keyboard route for a `<select>` does not work in Chromium on macOS

**What happened.** The plan drove the Settings ruleset `<select>` with `focus()` then
`page.keyboard.press("ArrowDown")`, stating that a closed `<select>` in Chromium moves its selection
and fires `change` that way. It does not on macOS: the arrow keys open the native popup and the
value is unchanged. `pnpm run test:smoke -- --project=desktop-shell newage-signin` failed on
`expect(ruleset).toHaveValue("newage-trident")` with the guard intact — a failure that reads as the
walk being wrong about the application rather than about the browser. The walk now uses
`selectOption(..., { force: true })`, with the enabled check asserted separately, and a comment
saying why.

**Why.** Chromium's `<select>` keyboard behaviour is platform-specific; on macOS the popup is the
native one. The plan's claim was written without running it, and nothing in the smoke suite
previously drove a `<select>` from the keyboard, so there was no counter-example in the repository
to check it against.

**Cost.** One smoke run and one round of diagnosis, about ten minutes.

**Prevent by.** In `plan-bead`, a plan that specifies a *keyboard* interaction with a native form
control (`<select>`, `<input type=file>`, a date picker) should name it as an assumption to verify
in the first increment rather than as settled fact — the same care the skill already asks for a
helper a plan cites. Where the control is only unreachable by pointer because an overlay covers it,
`selectOption(..., { force: true })` is the safe forcing: unlike a forced *click* it sets the value
on the element itself, so nothing lands on the overlay.

**Seen before.** `docs/retrospectives/ah-yk6b.md` is a different cause (React batching and a
rendered-index reduce) but the same family: a smoke walk's keyboard assumption that no vitest suite
could have caught, because `packages/shared` has no DOM.
