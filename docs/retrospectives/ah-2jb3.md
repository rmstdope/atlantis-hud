# ah-2jb3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-15
- **PR:** #1286

## The worktree went detached during the review, and two fix pushes did nothing

**What happened.** The worktree's reflog shows `checkout: moving from ah-2jb3-several-tabs to
11739c71` at 22:50:26, about a minute after PR #1286 opened and the cold-read `reviewer` sub-agent
was spawned. That sub-agent was given the worktree path and the head sha. The two commits that
answered review findings (579cb7a1, 1b3e2d5b) were made on that detached HEAD, and `git push -q`
pushed nothing and printed nothing. PR comments said "fixed in 579cb7a1", and the delta reviewers
reviewed those shas locally, while GitHub still showed 11739c71. A CI wait that compared
`headRefOid` with the new sha never matched, and a CI read that did not compare it reported green
for the old head. It came to light only when `gh pr checks` kept showing 11739c71 and
`git status -sb` said `## HEAD (no branch)`.

**Why.** It is established that HEAD was detached at the pinned sha. That the review sub-agent did it
is inferred: nothing else ran in that worktree at 22:50:26, and the prompt named both the worktree
and the sha. It is not proven.

**Cost.** About 15 minutes: a CI wait that could never finish, and a diagnosis.

**Prevent by.** `skills/implement-bead`, *Getting the review*: tell the review sub-agent not to
change the checkout (no `git checkout`, `switch` or `reset` in the implementer's worktree), or give
it no worktree path at all. And after every push, check `git status -sb` or compare
`git ls-remote --heads origin <branch>` with `git rev-parse HEAD`. `-q` hides the "nothing to push"
case.

**Seen before.** `ah-aao`: same symptom, a commit landing on a detached HEAD instead of the branch,
but a different cause (a git command run in an uninitialised submodule walked up to the worktree).
Two runs have now paid for a detached worktree HEAD that nothing reported.
