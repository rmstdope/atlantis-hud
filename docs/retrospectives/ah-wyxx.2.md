# ah-wyxx.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-08
- **PR:** #1063

## `git checkout -- <file>` after a RED experiment silently reverted a whole increment

**What happened.** To prove increment 4's test was genuinely RED, I temporarily broke the fix in
`packages/shared/src/unitCellPopup.ts`, ran the suite, saw the expected failure, and undid the
experiment with `git checkout -- packages/shared/src/unitCellPopup.ts`. That file's increment-4
changes were not yet committed, so the restore took the file back to `HEAD` — deleting the whole
fix, not just the experiment. `pnpm --filter @atlantis/shared test` had passed a minute earlier, so
I committed and only `pnpm run check:fast` caught it, four failing tests later.

**Why.** `git checkout -- <path>` restores the committed version of the entire file and takes no
account of which hunks were deliberate. Reverting an experiment and reverting the work look
identical to it.

**Cost.** One full `check:fast` run and a re-application of the edits, about eight minutes.

**Prevent by.** Commit the increment *before* running a deliberate-break experiment on it, so the
undo restores the work rather than deleting it. `implement-bead`'s test-driven loop already ends
each increment in a COMMIT; the trap is doing the RED-proof after the code and before the commit.

**Seen before.** `docs/retrospectives/ah-bkjd.md` (same command, same "takes no account of what in
the file was deliberate"), `docs/retrospectives/ah-9g3f.md` (restored the committed fixed version
and so hid a defect), `docs/retrospectives/ah-9g94.3.md` (its *Prevent by* recommends this very
command). This is the third sighting of one file-level restore destroying uncommitted work, and the
third is in a file that recommends the command — so the recommendation may want a caveat about
uncommitted hunks in the same file.
