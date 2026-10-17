# ah-1d3i — retrospective

- **Implementer:** Gambit
- **Date:** 2026-10-18
- **PR:** #1737

## A follow-up push silently went nowhere, the third bead to pay for it

**What happened.** The review fixes were pushed with a bare `git push -q | tail -1` from the
prepared branch `ah-1d3i`, whose upstream is `ah-1d3i-transport-target-engine`. Under git's
`simple` default the push was refused, the refusal was hidden, and a delta review was spawned on a
head GitHub never had. Only the reviewer's own fetch and `gh pr view --json headRefOid` showed the
PR still at the old commit. The explicit `git push origin HEAD:<pr branch>` that followed was itself
rejected once with a bare `(failed)`, and went through on an identical retry.

**Why.** The same mismatch ah-g4bz and ah-m1th describe: the prepared tree's branch name differs
from the PR branch's, and a bare `git push` will not push to an upstream with a different name.
The one-off `(failed)` rejection is not established.

**Cost.** About ten minutes: a review round started against a stale remote, a message to redirect
it, and a mergeability poll that then turned up a conflict with a main that had moved on meanwhile.

**Prevent by.** As ah-g4bz proposes: `produce-bead` *Building* names `git push origin HEAD:<pr
branch>` followed by a `git ls-remote` check against `git rev-parse HEAD` for every push, or
`scripts/prepare-worktree` names the branch `<id>-<slug>` from the start. Three beads have now
paid for this.

**Seen before.** `docs/retrospectives/ah-g4bz.md` and `docs/retrospectives/ah-m1th.md`.

## A concurrent bead fixed the same review finding while this PR was open

**What happened.** Review finding 2 (a DISTRIBUTE measured on the long reach) was fixed and tested
here. Meanwhile ah-4g2l (#1735) merged the same fix to main, so the rebase hit a conflict and this
PR's version was dropped in favour of main's.

**Why.** The finding was an older defect next to this bead. A sibling bead already in flight
carried it, and nothing told this session so.

**Cost.** One fix-and-test cycle thrown away, and a rebase conflict to resolve.

**Prevent by.** Before fixing a review finding that is an older defect outside the bead's own
claim, search the open and in-progress beads for it (`bd search <keyword> --status open,in_progress`)
and `git log origin/main` for its subject.

**Seen before.** Nothing like it yet.
