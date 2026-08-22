# ah-qled.10.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-22
- **PR:** cerebro#87, atlantis-hud#546

## Piping `git worktree add` into `tail` made an `&&` chain destroy uncommitted work

**What happened.** Diagnosing what looked like a location-dependent test hang, I tried to move my
cerebro worktree in one chain:

```bash
git worktree add /new/path <branch> 2>&1 | tail -2 && git worktree remove --force /old/path
```

The `add` failed — the branch was already checked out at the old path — but the chain's exit status
is `tail`'s, which is 0. So the `&&` fired and `remove --force` deleted the old worktree, which
still held about forty minutes of uncommitted work: a new test file and every prose edit for the
bead. Nothing was recoverable; there was no commit and no stash.

**Why.** Two things compounded. A pipeline's status is the last command's, so `cmd | tail` silently
swallows any failure and turns `&&` into an unconditional `;`. And `worktree remove --force` is
specifically the flag that removes the safety this case needed — the skill mandates `--force` for
*cleanup at the end of a run*, and I reached for the same command mid-run.

**Cost.** About forty minutes, redone from the edits still in my context. Had the context been
compacted first it would have been the whole bead.

**Prevent by.** Two concrete changes, both in `implement-bead`'s *Workspace* section:

1. **Commit before any worktree surgery.** Once the first RED test exists, commit it. A worktree
   that has been committed and pushed cannot lose work to any of this.
2. **Never pipe a git command whose failure should stop a chain.** Capture and check instead:
   `out=$(git worktree add ...) || { echo "$out"; exit 1; }`. The `| tail -N` habit for quieting
   noisy git output is safe only for the last command in a chain.

It is also worth saying explicitly that `worktree remove --force` belongs to *Finishing* and to
nothing else. Mid-run it is the one command in the workflow that can destroy work with no recovery
path.

**Seen before.** ah-3bl and ah-yvf both concern cerebro worktrees in the wrong location, which is
what I was trying to correct here — but neither describes losing work to the correction. This is the
third worktree-placement retrospective in the directory and the first with a real cost, which
suggests the placement rule for a *cerebro* worktree (as opposed to a consumer one) is still not
written down anywhere an implementer reads before making one.

## The hang that prompted the move was not reproducible

**What happened.** `tests/agent-state.sh` timed out twice at 120s and once at 300s inside my cerebro
worktree, while passing in the submodule checkout — which is what sent me looking for a
location-dependent cause. After the worktree was recreated at the same path, that suite and all 22
others passed repeatedly, including on the final run.

**Why.** Not established. The failing runs were the ones sharing a machine with a `for t in tests/*.sh`
sweep and other implementers' gates; the passing ones were not. Load is the obvious suspect and I did
not prove it.

**Cost.** It caused the finding above. On its own, about fifteen minutes.

**Prevent by.** Before treating a suite failure as environmental, re-run *that one suite alone* and
confirm it reproduces — the same rule `implement-bead`'s *Red CI* already applies to a suspected CI
flake, which would have applied here had I read it as covering local runs too. A timeout under
contention is not evidence about location.

**Seen before.** none found.
