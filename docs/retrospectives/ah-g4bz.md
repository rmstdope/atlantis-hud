# ah-g4bz — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-17
- **PR:** #1700

## A follow-up push silently went nowhere, because the tree's branch is not the PR's

**What happened.** The prepared tree is on branch `ah-g4bz`; the PR had to be opened from
`ah-g4bz-distribute-needs-the-senders-caravanserai` (the `<id>-short-description` convention), so
the first push was `git push -u origin HEAD:<that name>`. The review fix was then pushed with a
bare `git push -q ... | tail -1`. With `push.default` unset (git's `simple`), a branch whose upstream
has a different name is refused; the refusal went to stderr, `-q` and the pipe hid it, and the
session went on to wait for CI on a head that never reached GitHub. Only the mergeability poll,
which compares `headRefOid` with the local sha, showed the PR still at the old commit.

**Why.** The tree's local name and the remote name differ by design of `prepare-worktree`, and a
bare `git push` does not push to an upstream of another name under `simple`.

**Cost.** About five minutes of polling a head that was never going to appear, and one more round
of waiting for CI.

**Prevent by.** `produce-bead` *Building* could name the push command to use for every push after the
first: `git push origin HEAD:<pr branch>`, never a bare `git push`. Or, as ah-m1th already proposes,
`scripts/prepare-worktree` names the branch `<id>-<slug>` from the start, which removes the mismatch.

**Seen before.** `docs/retrospectives/ah-m1th.md`: the same mismatch between the prepared branch name
and the name the remote takes, met at the first push rather than at a later one.
