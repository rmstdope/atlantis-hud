# ah-djst — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-10-12
- **PR:** #1514

## The bug bead was handed out while the PR it builds on was still open

**What happened.** Bishop filed ah-djst from the review of ah-877p (PR #1507), and its fix says to
"move fleet_owner's local check onto" the shared rule. That check, `leave_refused_at_sea`, existed
only on #1507's branch, and the PR was still open (CI running, no merge) when the fleet view
assigned ah-djst to me. `bd show ah-djst` listed `dependency_count: 0`, so nothing on the bead said
it had to wait. I wrote and committed the reproduction test against main, then polled #1507 until it
merged before touching the implementation. Building on main instead would have rewritten the same
lines of `movement/fleet.rs`, `orders/effects.rs` and `orders/semantics.rs` that #1507 was changing.

**Why.** The bead was filed with no dependency edge on ah-877p. A follow-up found in a PR's review
names code the PR has not merged yet, and `scripts/bugfix-candidates` hands out any open, unclaimed
bugfix bead.

**Cost.** About 20 minutes of a claimed session doing nothing but polling.

**Prevent by.** When a bead is filed from the review of an open PR, add `bd dep add <new>
<that PR's bead>`, so `scripts/bugfix-candidates` and `bd ready` hold it back until the parent
closes. The step belongs wherever a follow-up is filed from a review: `produce-bead` *The review
loop*, the `bugfixer` hand-off, and Bishop's sweep.

**Seen before.** none found
