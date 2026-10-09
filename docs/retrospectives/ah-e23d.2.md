# ah-e23d.2 — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-09
- **PR:** #1467

## Two sessions fixed the same red main in parallel

**What happened.** #1467's `rust` job failed on
`silver_totals_are_its_movements::a_sharing_unit_says_where_its_loan_went` (-1942 against -1446),
which `origin/main` failed too since #1465 (ah-0mch) merged over #1466 (ah-9n7l.2). Nothing on the
board tracked it, so the navigator asked for a separate fix PR. That PR (#1470) traced the loan
(683's `@CAST CFSW` now funded by the sharers), was cold-reviewed and went green, and was then
CONFLICTING: Gambit's #1460 (ah-8n8y) had landed the identical correction as a commit on its own
bead's branch meanwhile. #1470 was closed unmerged. Its review did surface ah-jmr8 (a CAST is
charged per item where the engine charges inputs once per cast).

**Why.** Established: a red main is fixed by whichever session meets it first, and nothing tells
the others that one already has. Gambit fixed it inside an unrelated bead's PR, which the board and
the open-PR list do not show as "main fix in flight"; I searched beads and PR titles, not open PRs'
diffs.

**Cost.** About forty minutes and one CI cycle: the duplicate trace, a second cold review, and a
red-main question to the navigator that another session had already answered by its actions.

**Prevent by.** Before fixing a red main, `gh pr list --state open --json number,files` and look
for an open PR touching the failing test's file; and when a session fixes main inside another bead,
it files or labels the fix (a `main-red` bead, or a PR title naming the test) so the next session
finds it. Either belongs with ah-8n8y's proposed Cerebro post-merge alarm, which could also say
who is fixing it.

**Seen before.** ah-8n8y (same incident, its cause); ah-agze and ah-1wcw.6 (main broken after
crossed merges). This is the first recorded duplicate fix.
