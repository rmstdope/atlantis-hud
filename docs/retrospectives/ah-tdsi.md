# ah-tdsi — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-23
- **PR:** #607

## The disk floor blocked the bead before it started, and only a reclaim outside the project cleared it

**What happened.** `.claude/cerebro/scripts/disk-preflight` refused the run at 7.1 GB against the
8 GB floor, before the worktree existed. All three advertised offline reclaims
(`~/.cargo/registry/src`, `target/debug/incremental`, `~/Library/Caches/Mozilla.sccache`) were run
and returned 0.2 GB between them. `prune-worktrees.sh` then declined every build tree it found, each
correctly: `ah-e66j` was another implementer's live work, `ah-tdsi-mockup` held work not yet on main,
and `psylocke` is her verification tree. With nothing left inside the repository, I had to ask the
navigator, who authorised deleting two application caches in `~/Library/Caches`
(`com.spotify.client`, `com.microsoft.VSCode.ShipIt`, ~3 GB between them). That cleared it to 9.5 GB.

**Why.** Established. The floor is 8 GB, one implementer's `target` is ~1.6 GB and its
`node_modules` ~0.3 GB, and the machine runs several agents at once. The documented reclaims only
ever recover a few hundred MB, and every large tree on the disk legitimately belongs to a running
agent — so at three or more concurrent agents on a nearly-full disk there is no in-repository
reclaim, by construction.

**Cost.** About 15 minutes, one blocking question to the navigator, and a run that could not have
started unattended.

**Prevent by.** This is the twenty-ninth retrospective in this directory to name the disk, and the
several most recent ones already record that the documented reclaims are insufficient
(`ah-s0m`, `ah-l2i.3`, `ah-3cj4.1`) — so the finding is not new and the recording of it is not what
is missing. What this run adds is the one reclaim that worked and that no previous file could use:
space outside the project entirely. Two candidate changes for the navigator, neither an
implementer's to make: have `disk-preflight` list the largest reclaimable caches under `~/Library`
alongside its three project ones, so an agent can propose a specific deletion instead of asking an
open question; or cap how many implementers may hold a build tree at once, since the floor and the
per-agent tree size together already determine that number.

**Seen before.** ah-s0m, ah-l2i.3, ah-3cj4.1, ah-do8.2, ah-5jkt.2, ah-mi7, ah-quw, ah-do8.3,
ah-vkut, ah-uwa3, ah-qled.8, ah-1znc, ah-j0e, ah-o0d3, ah-8m0.3, ah-d00t, ah-kdgc, ah-8m0.2,
ah-58n.1, ah-9lv, ah-vfq, ah-l2i.1, ah-9r0, ah-udff, ah-y3j1, ah-87he, ah-l2i.2, ah-qled.7.2 — and
this file makes twenty-nine.
