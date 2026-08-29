# ah-dbw4 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-29
- **PR:** #789

## An existing smoke test flakes because it compares two counts it reads separately

**What happened.** `tests/smoke/foreignUnits.spec.ts`, `a concealed unit's faction cell pins every
unit hiding its faction`, ends with

```ts
await expect(page.getByTestId("foreign-pin-hidden")).toHaveCount(await rows(page).count());
```

Running the file after adding one test of my own, it reported `2 flaky` (passed on retry) on that
test with `locator resolved to 16 elements / unexpected value "16"` — i.e. the expected count, read
from `rows(page).count()`, was not 16. It is not my test: the same run reported my new test passing.

**Why.** Established, in the sense that matters: it is not caused by anything on this branch. I
measured the strip's height with and without my component change — `36.875` in both, with
`rows=16 hidden=16` stable over six samples — so the chip's border and padding do not change how many
rows the table windows. And running the test alone with `--repeat-each 5` flaked at a similar rate
**with my `ForeignStrip.tsx` change stashed** as with it applied. The cause is the assertion's own
shape: `toHaveCount` retries its side of the comparison for fifteen seconds while the expected value
was read once, up front, from a table that may still be settling after the pin. Whichever of the two
is read first can be the stale one.

**Cost.** About twenty-five minutes: a debug spec to measure the strip, two stash/restore cycles and
two `--repeat-each 5` runs (roughly three minutes of browser time each) to establish it pre-dated the
branch. No CI cycle — the flake is retried away in CI and reports green, which is exactly why it has
survived.

**Prevent by.** Make the expected side retry too, so the assertion is about a settled table rather
than about which read won:

```ts
await expect
  .poll(async () => (await page.getByTestId("foreign-pin-hidden").count()) === (await rows(page).count()))
  .toBe(true);
```

More generally, for `skills/plan-bead` and for anyone writing a smoke assertion: **never pass one
live count as the expected value of another live count.** `toHaveCount(await …count())` reads as
symmetrical and is not — only the left side retries. The same file already does this correctly
elsewhere with `expect.poll` (`await expect.poll(async () => (await counted(page)).pinned).toBe(all)`),
so the safe shape is present in the file beside the unsafe one. Fixing it is not this bead's to do —
it touches a test outside the bead's scope — but it is a two-line change for whoever next opens that
file.

**Seen before.** `docs/retrospectives/ah-y9hx.md` is the same *test file* and the same family — a
smoke assertion whose answer depends on the table having settled — but a different mechanism (a
`truncate`d `thead` cell that never becomes clickable in CI). No retrospective describes the
count-versus-count shape.

## Reaching for prettier in a repository that has no formatter churned the diff

**What happened.** After an increment I ran `npx prettier --write` on the two files I had touched, out
of habit. There is no prettier in this repository — no `.prettierrc`, no `prettier` dependency, no
`format` script (`grep -n '"format\|prettier' package.json` is empty). npx fetched prettier and
reformatted at its default 80 columns, rewriting **pre-existing** lines I had not touched: the
`thane` fixture object exploded across five lines, the `draw` helper's single call was split, the
component's props gained a trailing comma and two JSX elements were broken across four lines each.
`pnpm run check:fast` passed throughout, so nothing caught it — `git diff` did.

**Why.** Established. The repository formats by hand at roughly 100 columns and gates with eslint
alone, so there is no configuration for a formatter to read and nothing that rejects one having run.

**Cost.** About ten minutes to spot the unrelated hunks in `git diff` and undo them line by line, plus
the risk — had I not read the diff — of a review spent on formatting noise instead of the change.

**Prevent by.** Check for a formatter before invoking one: `ls .prettierrc*`, or
`grep -n 'prettier' package.json`. If neither answers, the repository has no formatter and hand
formatting to about 100 columns is the convention — `awk 'length > 100'` over the touched files is the
check that matches what the codebase actually does. Concretely, for `skills/implement-bead`'s *Building*
section: run only what `project-conf gate_fast` names, and treat any other tool over the tree as a
change that needs the same scrutiny as an edit.

**Seen before.** None found — `grep -rl prettier docs/retrospectives/` returns nothing.
