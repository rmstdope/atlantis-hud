# ah-lxq6w — retrospective

## The conflict route's force-push was refused by the permission classifier

**What happened.** PR #2016 went `CONFLICTING` while CI ran: ah-71z6y (#2017) had moved the walker
branch of `watered_moves_on` into `refused_water_step`. `produce-bead` *Merging* says to rebase onto
main and `git push --force-with-lease`. The rebase resolved cleanly, but the session's auto-mode
permission classifier refused the force-push as a destructive action. I merged `origin/main` into
the already-pushed branch instead, took the rebased tree byte for byte, and pushed a fast-forward.
The PR is squash-merged, so the extra merge commit never reaches main.

**Why.** The skill prescribes a force-push, and the bugfixer's permission settings do not allow one.
Neither knows about the other.

**Cost.** One refused command and about five minutes spent finding a non-destructive equivalent.
CI ran again on the new head either way.

**Prevent by.** Change `produce-bead` *Merging*, the `422`/`CONFLICTING` paragraph: either resolve
by merging the default branch into the PR branch and pushing normally (which is safe under squash
merge), or add a permission rule that allows `git push --force-with-lease` on a bead's own branch.

**Seen before.** No retrospective under `docs/retrospectives/` records a refused force-push.
