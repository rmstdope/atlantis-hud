# ah-49is retrospective

## `npx prettier --write` rewrote unitCellPopup.ts and its test again, the sixth time on record

**What happened.** After adding the `lent-for-give` arm to `packages/shared/src/unitCellPopup.ts`
and its cases to `unitCellPopup.test.ts`, I ran `npx prettier --write` on both files to tidy them.
The repository has no prettier, so npx applied its own defaults and rewrote about 3,200 lines. The
fast gate passed, since nothing in it fails a formatting-only diff, and the PR opened with a
6,560-line diff. I noticed only because the diff handed to the reviewer was suspiciously large.

**Why.** Habit: reaching for a formatter after a scripted edit. Nothing in the producer's path stops
it. `check:fast` is green on the churn, and `.cerebro/traps.md` does not mention it, although five
earlier retrospectives record the same mistake.

**Cost.** About ten minutes. I restored both files from the previous commit, re-applied the edits,
re-ran the tests and lint, and force-pushed before the review read the diff.

**Prevent by.** A `.cerebro/traps.md` entry: "This repository has no JS formatter; never run
`npx prettier`, and `pnpm run lint` is the only style check." Or a `check:fast` leg that fails on
a diff `npx prettier` would produce. Since five retrospectives already name it, the traps file is
the place that would actually be read before the edit.

**Seen before.** `ah-mw1r.3`, `ah-lbd9.4`, `ah-t8c4`, `ah-dbw4` and `ah-g9sf.7.1`, all under
`docs/retrospectives/`. `ah-mw1r.3` hit these same two files.
