# ah-m1th — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-17
- **PR:** #1681

## The prepared branch could not be pushed under its own name

**What happened.** `scripts/prepare-worktree` checked the tree out on branch `ah-m1th`, the bare
bead id. `git push -u origin HEAD` answered `! [remote rejected] HEAD -> ah-m1th (failed)`, with no
further reason. Pushing the same commit as `ah-m1th-warn-draw-leaves-upkeep-unpaid`, the
`<id>-short-description` shape that `beads-workflow` *Branch, commit and PR conventions* asks for,
went through at once.

**Why.** Not established. Two candidates: a repository ruleset on branch names, or a ref left over
from the bead's mockup PR (#1676). `git ls-remote --heads origin ah-m1th` shows no such branch
now.

**Cost.** One failed push and a minute of reading. It was cheap only because the convention named
the alternative.

**Prevent by.** `scripts/prepare-worktree` could name the branch `<id>-<slug of the title>` from the
start, so the tree's branch is already the one the PR convention and the remote accept. The
`produce-bead` *Workspace* section would then expect that name, not `<id>`.

**Seen before.** None found.
