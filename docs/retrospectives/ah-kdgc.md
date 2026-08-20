# ah-kdgc — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-18
- **PR:** #430

## The disk preflight blocked the bead before it started, and nothing in the repository could free the space

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts`, the first command of *Workspace*,
refused at 5.6 GB free against an 8 GB floor. `prune-worktrees.sh` reclaimed nothing: all four
worktrees were legitimately held (`ah-v09e-mockup` had unmerged work, `ah-vkut` was touched within
the half hour, and Psylocke's 2.6 GB verification tree is exempt by design). The caches the earlier
retrospectives name were already clear — no `Mozilla.sccache`, and the shared `target/` was 8 KB.
The only reclaimable space on the machine was `~/.cache/huggingface` at 8.3 GB: the navigator's own
data, nothing to do with this repository. I had to stop and ask before I could write a line of code.
**Why.** The disk floor is a machine-wide resource but every documented reclaim is repository-local.
When the repository is already as small as it goes and the machine is still full, an implementer has
no move left that is its own to make.
**Cost.** About five minutes and one navigator interruption, before any work on the bead began.
**Prevent by.** `diskPreflight.ts` could report the largest reclaimable directories outside the
repository as well as the build trees it names today — it already knows how to measure, and the
line it prints ("2.2 GB sits in 2 build trees") was actively misleading here, since those two trees
were 24 MB and 342 MB. Failing that, `implement-bead`'s *Workspace* section could say plainly that a
full disk with nothing repository-local to reclaim is a hand-back or an `asking`, not something to
work around, so an implementer does not spend the time discovering that for itself.
**Seen before.** ah-9r0, ah-l2i.1, ah-8m0.2, ah-vfq, ah-9lv — five previous files describe the disk
floor being crossed. This is the sixth, and the first where the repository held nothing to give.
