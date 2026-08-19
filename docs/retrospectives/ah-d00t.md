# ah-d00t — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-19
- **PR:** #455

## `diskPreflight.test.ts` failed mid-bead, and `prune-worktrees.sh` could reclaim nothing

**What happened.** `pnpm exec tsx scripts/diskPreflight.ts` passed at the start of the bead
("9.1 GB free, above the 8 GB floor"). By the time `pnpm run check:fast` ran after the review fix,
the disk had dropped to 7.1 GB and `scripts/diskPreflight.test.ts > the preflight as a command >
says what it found, and succeeds while this disk has room` failed, taking the whole `tooling` suite
and the gate red on a diff of two test files. This is at least the eleventh recorded sighting —
ah-9lv, ah-9r0, ah-87he, ah-58n.1, ah-1znc, ah-3cj4.1, ah-do8.2, ah-do8.3, ah-8m0.2 and others.

**What is new here, and is the reason this file exists at all.** `prune-worktrees.sh` — which every
previous retrospective on this reaches for, and which the preflight's own message recommends —
**reclaimed nothing**: all five trees were live (two holding unmerged work, one mine, two Psylocke's)
and it correctly kept every one. The preflight told me "7.3 GB sits in 5 build trees", which is true
and, at that moment, entirely unactionable.

What actually freed the space was outside the repository altogether:

| Reclaimed | Freed | Safe because |
|---|---|---|
| `target/debug/incremental` in my own worktree | 602 MB | rebuildable, and mine |
| `~/Library/Caches/ms-playwright/chromium{,_headless_shell}-{1208,1217}` | ~1.0 GB | stale browser builds; the repo pins `@playwright/test ^1.55.0`, which uses 1234 |

That took the disk from 7.1 GB to 8.6 GB and the gate went green unchanged. The Playwright cache had
accumulated **three** Chromium versions and three headless shells; only one of each is ever used.

**Why.** Not established for the general growth. But the specific reason the documented remedy failed
is established: `prune-worktrees.sh` only ever considers `.cerebro/worktrees/`, and with a
healthy fleet every tree in there is legitimately in use. The largest reclaimable thing on this
machine was a shared cache no script looks at.

**Cost.** About 20 minutes: one failed `check:fast`, a prune that freed nothing, working out where
the space actually was, and a re-gate. No CI cycle — the failure was local only.

**Prevent by.** Two changes, both outside a planned bead and so the navigator's:

1. **Teach `prune-worktrees.sh` (or the preflight's advice) about the Playwright cache.** Deleting
   every `~/Library/Caches/ms-playwright/chromium*` directory whose version is not the one the
   lockfile resolves is safe, mechanical and worth ~1 GB per stale version. As it stands the
   preflight points implementers at the one thing that may well be unreclaimable and says nothing
   about the one that is.
2. **Make the preflight's failure message say what is reclaimable, not merely where bytes are.**
   "7.3 GB sits in 5 build trees" reads as an instruction to prune; when all five are live it is a
   dead end, and each implementer rediscovers that alone. Naming stale caches alongside it would
   have saved every one of the last eleven sightings some fraction of this.

**Seen before.** ah-9lv, ah-9r0, ah-87he, ah-58n.1, ah-1znc, ah-3cj4.1, ah-do8.2, ah-do8.3, ah-8m0.2,
ah-j0e, ah-quw, ah-s0m, ah-vkut — same test, same floor. None of them records `prune-worktrees.sh`
reclaiming nothing, or the Playwright cache as the reclaim that worked.
