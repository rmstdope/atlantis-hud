# ah-vdav — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-14
- **PR:** #1581

## The bug bead was handed out while the PR it builds on was still open

**What happened.** ah-vdav was filed from ah-ayg7's work ("Found in ah-ayg7") and assigned to me
while ah-ayg7's PR #1572 was open and conflicting with main. The fix needs #1572's mechanism (the
column's maintenance settlement carrying a refused order's hand-back), so it could not be built on
main. I wrote the RED test on main, drafted the fix on #1572's branch, and then waited. While I
waited, #1572 changed its approach (from `upkeep_paid_from_refused` to a second settlement keyed
on `maintenance_hands_back`), and main refactored `purse_carried` into `UpkeepSilver`.

**Why.** No dependency edge from ah-vdav to ah-ayg7, so `scripts/bugfix-candidates` treated it as
ready.

**Cost.** About 45 minutes of waiting on another bead's PR, and the same fix written three times
against three shapes of the code.

**Prevent by.** When a bead is filed from an open PR's bead, `bd dep add <new> <that bead>` at
filing, so `bugfix-candidates` holds it until the parent merges. This is the same prevention
ah-djst named; it has not been adopted yet.

**Seen before.** ah-djst.
