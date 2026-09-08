# ah-lcs1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-08
- **PR:** #1058

## `study-planner.spec.ts` "a note is kept without pressing anything" flakes on main, and reads as a regression

**What happened.** CI's `smoke (desktop-shell, 1, 2)` failed on this PR at
`tests/smoke/study-planner.spec.ts:341` — the note textarea held `"heading for Gate Lore"` where
the spec expected `"heading for Gate Lore, then Portals"`. The diff is two pure string functions in
`packages/shared/src/ordersDocument.ts` with no path to a note textarea, so this looked impossible,
and the first local run reproduced it, which made it look like a real regression. It is not: a
worktree at unmodified `origin/main`, run as
`pnpm run test:smoke -- --project=desktop-shell -g "a note is kept without pressing anything" --repeat-each=3`,
failed on the first attempt in two of three runs and was reported `flaky` in all three. The same
command on the branch also reports `flaky` rather than `failed` on most runs.

**Why.** The spec races its own debounce, by design and with a comment saying so: the `fill` and the
`Escape` must both land inside `STUDY_NOTE_AUTOSAVE_MS` (400ms) or the debounce writes on its own
and the assertion stops proving the unmount flush. Two CDP round-trips inside 400ms is not reliably
generous on a loaded machine or a CI runner. Playwright's retry usually hides it; when the retry
loses the race too, the job goes red.

**Cost.** One CI cycle plus about thirty-five minutes: reproducing it, building a second worktree at
`origin/main` to bisect against, and repeat-running both sides before the re-run was justified.

**Prevent by.** The spec should not depend on losing a race it can be made to win — asserting the
unmount flush wants a deterministic hold on the debounce (a test hook, or a clock the spec
controls), not a 400ms budget for two round-trips. Filing that is the navigator's call, not an
implementer's. Until then, the useful thing is knowing it is pre-existing: a red
`smoke (desktop-shell, …)` on this one test name is a flake, and the cheap check is
`--repeat-each=3` against a worktree at `origin/main` before believing your own diff caused it.

**Seen before.** None found for this spec (`grep -rln 'a note is kept\|STUDY_NOTE_AUTOSAVE' docs/retrospectives/`
matches nothing).
