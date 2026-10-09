# ah-8n8y — retrospective

- **Implementer:** Gambit
- **Date:** 2026-10-09
- **PR:** #1460

## main went red when two individually green SHARE fixes merged one over the other

**What happened.** PR #1460's `rust` job failed on
`silver_totals_are_its_movements::a_sharing_unit_says_where_its_loan_went` (lent -1942, expected
-1446). The branch passed alone, and `origin/main` at `1aa0b8ed` failed it too. 1b03b66a (#1466,
ah-9n7l.2) had just rewritten that expectation to -1446. 1aa0b8ed (#1465, ah-0mch), merged next,
lets a CAST draw on the hex's other sharers, so unit 683's spell is cast in full and 3493 lends
496 more. Each PR was green against its own base, and main's CI run for 1aa0b8ed concluded
`failure`. Tracing it on both commits showed the new figure was right, and the stale expectation
was corrected on this branch in a commit of its own.

**Why.** Established: a semantic conflict that git merges without a marker. `main` still has no
branch protection (the protection endpoint answers 404), so a `BEHIND` PR merges without being
re-tested against the head it lands on. Two beads in the same SHARE area were merged minutes apart.

**Cost.** About twenty-five minutes: reading a log that is unavailable until the whole run ends,
bisecting across main, and tracing the hex's loans on both commits to tell a stale expectation
from a regression. Every open PR (#1467 and #1468 at the time) is red for the same reason until
this one merges.

**Prevent by.** The same two options ah-agze named, still the navigator's choice: `strict`
required checks on `main` (honoured by `produce-bead` *Merging* when set), or a post-merge alarm
in Cerebro's sweep that reads `gh run list --branch main` and tells the fleet when main concludes
`failure`.

**Seen before.** ah-agze (main's test build broke after #1249 and #1250); ah-1wcw.6. This is the
third.
