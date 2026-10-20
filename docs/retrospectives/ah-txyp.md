# ah-txyp — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-20
- **PR:** #1825

## Smoke expectations of "4 more ↓" green on macOS, red on CI

**What happened.** The new rule stops counting a row whose start is on screen. Locally, on macOS, all six hidden-count smoke tests passed with "4 more ↓". On CI the three default-rail tests (orders-editor.spec.ts, the "says how many are below", "never covers the visible row's text" and "do not re-wrap" tests) read "3 more ↓" on both web and desktop-shell.

**Why.** At the smallest panel the list holds two lines (ah-8zbc's floor). With macOS fonts the typical row wraps onto two lines and fills the list, so row two starts at the list's bottom. With CI's Linux fonts the row stays on one line, row two starts on screen, and under the new rule it is not counted. Before this bead the old rule counted the partly shown row too, so the count came out at 4 on both platforms and the dependence on fonts never showed. The plan said those tests "stay as they are" without checking how CI's fonts lay the rows out.

**Cost.** One CI cycle (about 12 minutes) and one of the bead's three fix attempts.

**Prevent by.** A plan that changes a measured count or height in `tests/smoke/orders-editor.spec.ts` names, for each expectation, whether it is font-dependent. The narrow-rail tests exist because they are not (`narrowRightRail`'s comment). Default-rail expectations of a layout-derived number should be a range, as `DEFAULT_RAIL_MORE` now is.

**Seen before.** ah-8zbc and ah-1uj describe CI's Linux fonts wrapping rows differently from macOS's.
