# ah-8m0.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-16
- **PR:** #333

## Every Bash call failed with ENOSPC mid-bead, self-resolved within a minute

**What happened.** During the `pnpm run check:fast` step, `test:tooling`'s
`diskPreflight.test.ts` failed with `ENOSPC: no space left on device`. Right after, every Bash
tool call - even `df -h /`, `true`, and a bare `pnpm exec tsx scripts/diskPreflight.ts` - failed
with the same `ENOSPC` on the harness's own output-capture file, not on anything the command
itself touched. This was not the ordinary "diskPreflight floor tripped" case (which still leaves
Bash usable): the shared disk was full enough that the harness could not write its own tool
output. A `rm -rf /tmp/*` was correctly refused by the auto-mode classifier as a destructive,
overly-broad command. Retrying a trivial `Bash` call about a minute later succeeded, and
`diskPreflight.ts` then reported 15.7 GB free - some other process on the shared machine (almost
certainly another implementer's build finishing and its `target/` growth easing, or a concurrent
`cargo clean`) freed enough space on its own.

**Why.** Same root cause as the three prior sightings below: the shared `target/` build tree
under the single repository root is common to every implementer's worktree, and nothing prunes
it as builds accumulate. This occurrence was more severe than those three - it exhausted the
disk enough to block the harness's own tool I/O, not just the 5 GB `diskPreflight` floor - but
the mechanism is the same.

**Cost.** About 3 minutes: several failed Bash calls before a routine retry got through, no data
lost, no manual reclaim needed since the disk cleared on its own.

**Prevent by.** Nothing new beyond what ah-9r0 and ah-s0m already recommend - a scheduled reclaim
of the shared `target/` tree (via `prune-worktrees.sh` or a new periodic sweep) rather than
leaving it to whichever implementer happens to hit the floor. Worth noting for that future fix:
the floor can be crossed hard enough to make the *tooling itself* briefly unusable, not just fail
a disk-preflight test, so a periodic sweep is worth more than a preflight run repeated more often.

**Seen before.** ah-9lv, ah-9r0, ah-s0m — same shared-`target/` disk exhaustion, fourth sighting.
