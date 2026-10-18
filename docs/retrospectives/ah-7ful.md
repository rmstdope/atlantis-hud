# ah-7ful — retrospective

- **Implementer:** Gambit
- **Date:** 2026-10-18
- **PR:** #1763

## The bug bead was handed out while the PR that filed it was still open, and both rewrote the same walk

**What happened.** ah-7ful was filed from the review of ah-vweq (PR #1756). Gambit was assigned it
while #1756 was still open. I built the fix on main, and the first review round asked for the
movement side's EVICT to see units formed in place. To do that I added a record of FORM blocks to
`WrittenMovement`. Meanwhile #1756 merged with its own record (`FormedAtPromotion`,
`formed_at_promotion`), covering the same FORM blocks and the same `evictions_in` call. My PR went
`CONFLICTING`. I threw away my record and rebuilt the movement side on top of ah-vweq's. That took
another gate run and another full review round. I had also filed ah-b7et for TRANSPORT, which
duplicated ah-vweq's ah-ry88, and had to close it as a duplicate.

**Why.** Established. The bead had no dependency edge on ah-vweq. `scripts/bugfix-candidates` hands
out any open, unclaimed bugfix bead, even one that names code an open PR is changing. This is the
same cause ah-djst recorded.

**Cost.** About 45 minutes: one discarded implementation of the finding-1 fix, a hand rebuild of
`movement/fleet.rs`, one extra gate run and one extra review round, and a duplicate bead.

**Prevent by.** ah-djst's prevention, still not in place: when a bead is filed from the review of
an open PR, run `bd dep add <new> <that PR's bead>`. The step belongs in `produce-bead` *The review
loop* and the bugfixer hand-off. Second, before starting, a bugfixer can run
`gh pr list --search "<function named in the bead>"` against open PRs. That would have shown #1756.

**Seen before.** ah-djst (2026-10-12): same cause, a follow-up bug bead handed out while its parent PR
was open.
