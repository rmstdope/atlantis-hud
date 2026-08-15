# ah-t2i — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-15
- **PR:** #250

## The plan's test-approach citation pointed at a pattern that doesn't exist in this repo

**What happened.** The plan's increment 2 said to add the first pointer test to
`MapCanvas.test.tsx`, "render with `@testing-library/react` as the selection-ring tests there do."
No test in the repository uses `@testing-library/react`, and the package is not in the lockfile
anywhere — `ls node_modules/.pnpm | grep testing-library` and `grep -r jsdom` both came back empty.
Worse, four *other* component test files
(`BadgeMenu.test.tsx`, `UnitListLimitStepper.test.tsx`, `PanelSplitter.test.tsx`,
`UnitTableDock.test.tsx`) explicitly document the opposite convention in their own header comments:
"there is no jsdom here... pointer choreography is the smoke suite's business." `MapCanvas` also
carries hook state, so it cannot be called directly as a plain function the way those stateless
components' tests do, which is the trick that makes the no-jsdom convention work at all there.
**Why.** Not established with certainty, but the shape suggests the plan was written by pattern-
matching on the *idea* of a selection-ring assertion rather than verifying an actual test file
existed to imitate — there is no test anywhere touching a "selection ring" via testing-library, only
markup assertions via `renderToStaticMarkup` (`MapCanvas.test.tsx:265-287`).
**Cost.** About 15 minutes: `find`/`grep` across `node_modules/.pnpm`, `package.json` and every
`*.test.tsx` file to confirm the tooling genuinely wasn't there before concluding the plan's
citation was wrong, rather than something I'd missed.
**Prevent by.** When a plan cites "the same pattern an existing test uses," a planning session
should name the specific file, not just describe the pattern in prose — `grep`-checking a citation
before writing it into the plan is cheap, and a wrong citation here cost the implementer the same
search the planner should have already done. I resolved it as a detail-level deviation (mine to
decide, not scope/UX) and covered the same behaviour end-to-end in the smoke suite instead; recorded
in the PR body.
**Seen before.** None found (`grep -rl "testing-library\|jsdom" docs/retrospectives/` was empty).

## A gesture that recentres the view is not idempotent at a fixed screen pixel

**What happened.** The plan's increment 3 suggested right-clicking "the same spot again" to prove
idempotence once a hex is already centred. Clicking the same *screen coordinate* twice failed that
assertion outright — after the first right-click moves the view, the hex now sitting under that same
pixel is a *different* hex, so a second click there legitimately recentres again. Diagnosed by
building a throwaway debug spec that dumped `document.elementFromPoint` and the map transform at
each step; deleted before commit.
**Why.** `centreOn` (and hence the recentre gesture) centres against the *hex under the pointer*, not
the screen position clicked — so "click the same spot" only tests idempotence if that spot still
names the same hex, which is only true before the first click moves anything.
**Cost.** About 25 minutes, mostly building and iterating on the throwaway debug spec to find the
actual visible-centre point (which also is not the map canvas's own geometric centre — the side
panes' insets are asymmetric enough that using `box.width/2, box.height/2` picked a point covered by
a panel header, not open ground).
**Prevent by.** For any test asserting idempotence of a view-changing pointer gesture, compute the
*target hex's* on-screen position fresh after each click (or, as done here, compute the visible
centre the same way `mapOverlayInsets.ts` does, from live `[data-map-overlay]` boxes) rather than
reusing a screen coordinate captured before the first click.
**Seen before.** None found.
