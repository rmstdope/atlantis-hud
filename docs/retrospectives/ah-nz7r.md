# ah-nz7r — a bug filed from an open PR's review was handed out before that PR merged

## The fix the bead needed was in an unmerged sibling PR

**What happened.** ah-nz7r was filed from finding 3 of the review of PR #1502 (ah-g0fk) while #1502
was still open, and it was assigned to a bugfixer straight away. The right fix reuses
`first_sail_step_refused`, which #1502 added, and the passenger half of the same bug (`carried_away`)
was also #1502's. On main, the reproduction test for the unfinished ship stayed red unless I
rebuilt #1502's `carried_away` filter. I tried that, and 9 existing fixtures that sail land to land
broke: the same fixtures #1502 rewrites. I reverted and waited about 20 minutes for #1502 to merge,
then rebased and reworked my helper onto its function.

**Why.** The bead has no dependency edge on ah-g0fk, so `bugfix-candidates` offered it as ready
while the code it builds on was still under review.

**Cost.** About 20 minutes of waiting, plus one duplicated fix that was thrown away, and a rebase
that rewrote my helper's signature.

**Prevent by.** When a bead is filed from a finding on a PR that is still open, add
`bd dep add <new> <the PR's bead>` at filing time (the reviewer step in
`.cerebro/cerebro/agents/reviewer.md` / the producer's *The review loop*, where a finding is turned
into a bead). `scripts/bugfix-candidates` then holds the bead back until the sibling closes.

**Seen before.** No retrospective found for a bead blocked on an open sibling PR (searched for
"open PR", "unmerged", "depend").
