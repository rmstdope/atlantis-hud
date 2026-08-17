# ah-58n.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** #392

## The opening disk preflight passed against a lower floor than the gate then enforced

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` at the start of the bead printed
"9.6 GB free, above the 5 GB floor" and exited 0. Every later run of the same script — and
`scripts/diskPreflight.test.ts` inside `pnpm run check:fast` — printed "7.7 GB free, below the 8 GB
floor needed to build" and exited 1, so the gate could not be green on this machine whatever the diff
contained. `.claude/cerebro/scripts/prune-worktrees.sh` reclaimed nothing: all four trees were either
live work or Psylocke's. CI was green on every job, including `native`.

**Why.** Two causes, and only the first is the familiar one. The disk genuinely fell ~2 GB during the
bead, as it does whenever several implementers build at once. But the two checks also reported
*different floors* for the same script — 5 GB at the start, 8 GB later — so the opening preflight can
pass on a disk the gate will reject minutes later, with nothing having gone wrong in between. Whether
the floor scales with the number of build trees I did not establish from the source.

**Cost.** About ten minutes: a prune attempt, a second gate run to confirm the failure was
environmental, and a paragraph in the PR body explaining why one test is red.

**Prevent by.** Having `diskPreflight.ts` print the floor it is *about to require of the gate* rather
than the one it is applying to itself — or, if the floor is deliberately dynamic, printing what makes
it move, so an implementer that passes the opening check can tell whether it has actually cleared the
bar it will be held to. `implement-bead`'s *Workspace* section presents the opening call as the
go/no-go for disk, and on this run it was not one.

**Seen before.** ah-l2i.1 (which counted itself the fifth), ah-9r0, ah-9lv, ah-8m0.2, ah-8m0.3 — all
the same script failing mid-bead after the opening call passed. The differing-floors detail is new
here; the rest is the sixth sighting.
