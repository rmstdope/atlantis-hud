# ah-sybfj — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-10-24
- **PR:** #1867

## A squash of my own commits reverted two beads that had merged meanwhile

**What happened.** To fold two WIP commits into one I ran `git reset --soft origin/main` and
committed. Between the worktree being prepared (base `81f97dc9`) and that reset, another session's
fetch moved the shared `origin/main` ref to `a12e2e1a`. The soft reset kept my tree, which was the
old main plus my edits, so the commit's diff against the new `origin/main` silently undid ah-y0ptc
(#1864: `levelToFollow` in `hexMapModel.ts` and `AppShell.tsx`) and, by the time CI ran, ah-iuofk
(#1865) as well. The fast gate passed, because a reverted tree is a consistent tree. The review
sub-agent caught it as a "blocks merge" finding.

**Why.** Remote-tracking refs are shared between all worktrees of a clone, so `origin/main` in an
agent's worktree moves whenever any session fetches. `reset --soft <ref>` takes the ref's commit as
parent and keeps the tree, which turns every commit that landed in between into a revert.

**Cost.** One review round, a rebuild of the branch from the reflog (diff `81f97dc9..` of my WIP
head, applied to the fresh main), one re-gate, and a force push. About twenty minutes.

**Prevent by.** In `produce-bead` *Building*, before opening the PR, check
`git diff --stat "origin/$(scripts/default-branch)"...HEAD` lists only the files the plan names. And
squash with `git reset --soft "$(git merge-base HEAD origin/main)"`, never with a bare
`origin/main`.

**Seen before.** ah-9g3f (its second section: "Reverting to prove a test red must use the branch
point, not `origin/main`"), the same cause in a different command.
