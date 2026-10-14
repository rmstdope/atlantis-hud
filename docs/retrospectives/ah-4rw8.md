# ah-4rw8 — retrospective

## A verification follow-up asked to reverse agreed design, against a build main had already moved past

**What happened.** Psylocke filed ah-4rw8 while verifying ah-su1x at d86431c. It listed three
symptoms of a cut BUY in a SHARE hex: the buyer's SILVER cell was red ("cannot pay the 81"), its
upkeep was "paid by a faction-mate's silver (18)", and the hex showed a shortfall. Its acceptance
asked for all three to go. Two of them are what ah-omn7 (Q1, option B: "the same warning,
reworded"; option C, "cut it quietly", rejected) and ah-szye (the cut line points at the hex's
Problems entry) agreed, and the plain swords case reads the same way. The third, the faction-mate
relief, was a real bug. But ah-rbei (6cefad2c), merged before the bead was claimed, had already
fixed it. The fix shipped as a regression test only, after the navigator was asked to choose.

**Why.** The follow-up was written from what the screen showed at the verified sha, with no check
of the cut-BUY decisions on record, and with no re-check on main before it was handed out.

**Cost.** About an hour of a bugfixer session: reproducing the bug, reading two beads' plans to
find the agreed decisions, bisecting three commits in scratch exports, and one question to the
navigator.

**Prevent by.** `skills/fix-bug` step 1 could re-run the reported case on `origin/main` before
writing a reproduction test, and grep the closed beads that own the surface (here
`bd show ah-omn7`/`ah-szye` design, *User-facing decisions*) for an agreed shape the acceptance
would reverse. Psylocke's follow-up template could likewise name which symptoms are already agreed
design.

**Seen before.** Not in `docs/retrospectives/`.
