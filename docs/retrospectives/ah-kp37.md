# ah-kp37 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-05
- **PR:** #986

## The plan's smoke fixtures made the feature's own rule impossible to observe

**What happened.** The plan's increments 7 and 8 name the walk exactly: the world lists turns 70,
71 and 72, the game shows turn 71, and pressing `Fetch all 2 missing` leaves both fetched rows
marked `stored`. Turn 72 is *newer* than the turn on screen, so `routeReport` answers `load` for it
and it becomes the working turn. `pnpm run test:smoke -- newage-fetch` failed on
`Received string: "72Januaryplaying"` — the feature working correctly against a test that could not
be satisfied. The same fixture choice hid a real defect until the review found it: nothing stopped
`Fetch all N missing` asking for a turn newer than the one on screen and quietly replacing what the
player was looking at, which is exactly what the dialog's own blurb promises will not happen.
**Why.** The plan chose three consecutive fixture turns and the middle one as the working turn,
which reads naturally but leaves one of the two "earlier" turns not earlier at all. A bead about
turns *older* than the screen needs the working turn at the top of the fixture range.
**Cost.** One 1.3-minute smoke run plus the rewrite of two walks, about fifteen minutes; and one
review round that would otherwise have been spent elsewhere.
**Prevent by.** A plan whose subject is an ordering rule ("earlier", "newer", "already held")
should say in its *Test plan* which fixture is the working turn and why, not only which fixtures are
used — the ordering is the thing under test, so leaving it implicit puts it outside the tests. This
plan's own *Increments* section names `g7f95t70/71/72` without ever saying which one is on screen.
**Seen before.** None found: `grep -rl "routeReport\|storeOnly\|newer than the working"
docs/retrospectives/` matches nothing.
