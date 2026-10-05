# ah-0unf — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-05
- **PR:** #1396

## A `toBeInViewport({ ratio: 1 })` passed locally and failed on both CI smoke jobs at 0.989

**What happened.** A review finding asked for a test that the keyboard walk scrolls "nearest". The
new step in `tests/smoke/magic-tree.spec.ts` pressed Page Down twice to ILLU and asserted
`toBeInViewport({ ratio: 1 })` on it. Locally (macOS, web project) it passed. In CI it failed on
both `smoke (web, 1, 2)` and `smoke (desktop-shell, 1, 2)` with `viewport ratio 0.9893617033958435`.

**Why.** A row that `scrollIntoView({ block: "nearest" })` brings in from below lands flush against
the scroll container's bottom edge, and on the Linux runner, with its different font metrics, the
row's height left a sub-pixel of it outside. Established only as far as the received ratio shows.
The `ratio: 1` was not needed: the assertion that guards the behaviour is the one on a row *above*
the edge (CRWC), and that passed.

**Cost.** One CI cycle of about fifteen minutes, and one of the bead's three fix attempts.

**Prevent by.** `tests/smoke/README.md` (or the smoke helpers' header in `tests/smoke/gameSetup.ts`):
a note saying that `ratio: 1` and exact pixel equalities on an element placed by the browser's own
scrolling or centring are not portable between macOS and the Linux runner. Assert full visibility only
on an element that has a margin to the edge, and assert "in view" (`ratio: 0`) on one that was scrolled
to an edge.

**Seen before.** ah-7rd and ah-l2i.2: the same kind of failure, an exact sub-pixel expectation on a
browser-placed position, there in the map's centring transform.
