# ah-ottr — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-17
- **PR:** #1712

## The agreed experience described today's screen wrongly

**What happened.** The acceptance said the warning mark "still follows the cell's contents, after
the shortfall", and the states list said "⚠ after the shortfall text, as today". Both mockups draw
`33  8650 short ⚠`. But the app draws the ⚠ *before* the figure (`⚠33`), and has done since the
warned cell became a button (`SeverityMark` then `{figure}` in `UnitTableDock.tsx`). Taken
literally, the agreed words would have moved the ⚠ on short cells only, so warned cells would
disagree with each other. Building it required a question to the navigator. The navigator chose to
keep the ⚠ first.

**Why.** The mockup was drawn from a description of the cell, not from the cell itself. Nothing in
the UX stage checks a "today" claim against the running application or the code.

**Cost.** One navigator question during design (short, since the navigator was present). Without an
answer it would have been a park back to UX and a second UX pass.

**Prevent by.** The `agree-experience` skill: anything the acceptance calls "as today" or
"unchanged" is checked against the shipped component (a screenshot of the real shell, or the JSX
named in the mockup's notes) before the mockup is committed.

**Seen before.** Not found in `docs/retrospectives/`.

## The default Silver column cannot hold the agreed long form

**What happened.** The first smoke run failed because the shortfall was already `▾…` at
Playwright's default viewport. At that size the SILVER column is about 68px wide (52px of content),
so a four-digit shortfall cannot be spelled out, nor even shown as `▾8650`. The agreed
`33  8650 short` appears only in a wider window or column. The test now starts at a 2400px
viewport and steps down. The default column width is unchanged, since it is not this bead's to
decide, but the verifier and the navigator will mostly see the short forms.

**Why.** The mockup's table gives SILVER a fixed 150px. The app's default share is
`96 / NOMINAL_TABLE_PX` of a dock panel. Nobody compared the two.

**Cost.** One failed smoke run and a rewrite of its viewport steps. There is also a likely
verification surprise: at the default size the agreed long form is not what shows.

**Prevent by.** The `agree-experience` skill: a mockup that adds text to a table cell states the
column width it assumes, and is checked against that column's default share in `unitTable.ts`.

**Seen before.** Not found in `docs/retrospectives/`.

## A global replace in a test edit changed an unrelated test

**What happened.** Editing the new smoke test, I replaced a `setViewportSize({ width: 700, … })`
line with a Python `str.replace` that had no count. The same line existed in "movement capacity
updates in the unit list and detail", which was silently widened to 1000px. That removed its
narrow-window guard. The review sub-agent's cold read caught it (finding 4).

**Why.** The edit was keyed on a line's text rather than its position, in a 6000-line spec file
where helper lines repeat.

**Cost.** One review finding and a fix commit. Had it merged, a layout guard would have gone without
anyone noticing.

**Prevent by.** `produce-bead` *Building*: before the PR, read `git diff origin/main -- <spec>` for
hunks outside the tests the plan names. Any hunk in an unnamed test is either explained in the PR
body or reverted.

**Seen before.** Not found in `docs/retrospectives/`.
