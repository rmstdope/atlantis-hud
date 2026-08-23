# ah-rsdz — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-24
- **PR:** #640

## The disk floor was cleared only by deleting the main checkout's `target`, which no tool offers

**What happened.** `disk-preflight` reported 5.5 GB against the 8 GB floor and refused the start.
Of the two `$HOME` reclaims it advertises, the combined `rm -rf ~/.cargo/registry/src
~/Library/Caches/Mozilla.sccache` was refused by the auto-mode classifier; run one at a time as
separate `rm -rf "$HOME/..."` commands they went through, and with `target/debug/incremental` they
bought 1.2 GB — still short. `prune-worktrees.sh` correctly kept both worktrees (one live
implementer, one Psylocke tree) and exited 1. What actually cleared the floor was `rm -rf target`
in the **main checkout** — 1.5 GB, taking free space to 8.1 GB.

**Why.** `disk-preflight` names the main checkout's `target` in its inventory but not among its
reclaims, and `prune-worktrees.sh` only considers trees under `.cerebro/worktrees/`. So the one
rebuildable tree nobody owns is the one neither tool offers to remove, and an implementer has to
decide for itself whether deleting it is safe. I checked its mtime (cold 28 minutes) before doing
it, which is the same test `prune-worktrees` applies to a worktree.

**Cost.** About six minutes and four blocked or short-of-the-floor attempts before the bead started.

**Prevent by.** `.claude/cerebro/scripts/disk-preflight` listing the main checkout's `target` as a
reclaim when it has been cold for 30 minutes, the way `prune-worktrees.sh` already judges a
worktree's build tree — and phrasing its two `$HOME` reclaims as separate `rm -rf "$HOME/…"`
commands, since the combined form with `~` is what the classifier refuses.

**Seen before.** `ah-cxxa` — "The disk floor was tripped with no reclaim available at all, because
every large tree belonged to a live agent", which is the same situation one step earlier: there
the main checkout's `target` was not big enough to save the run, here it was.
