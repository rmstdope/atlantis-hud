# ah-o0d3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** #499

## The machine filled up completely, and this time nothing freed it on its own

**What happened.** After several hours idle on an empty queue, a routine poll died with
`ENOSPC: no space left on device` writing the harness's own tool-output file under
`/private/tmp/claude-501/…`. `df -h` showed **319 MiB free of 228 GiB** — 100% on
`/System/Volumes/Data`. Unlike the ah-8m0.2 sighting, retrying a minute later did **not** help; the
disk stayed full until the navigator freed it by hand, after which `diskPreflight.ts` reported
14.6 GB and the session continued normally.

**Why.** Not established from inside the session. `diskPreflight.ts` afterwards attributed 3.5 GB to
a single leftover `target/` build tree and pointed at `prune-worktrees.sh`, so accumulated worktree
build output is a plausible contributor, but I did not prove it was the bulk of the 228 GB.

**Cost.** No CI cycles and no lost work — the queue was empty at the time, so nothing was in flight.
The real cost is what it would have been an hour later: had this landed mid-bead, every `Bash` call
including `agent-state` would have failed, and an implementer that cannot write its state file is
indistinguishable from a dead one.

**Prevent by.** The preflight only runs when an implementer *starts* a bead
(`implement-bead`'s *Workspace* section), which is exactly when it is least likely to catch a slow
fill. Cerebro already sweeps worktrees every ten minutes; having that sweep also check the disk
floor and report when it is approached — rather than each implementer discovering it at claim time —
would turn this from an outage into a warning. That is a change to `orchestrator.md` and so the
navigator's to make.

**Seen before.** ah-8m0.2 (2026-08-16) — same `ENOSPC` on the harness's own output file. That one
self-resolved within a minute; this one did not, which is the difference worth noting. **Second
sighting.**

## `bd ready --label planned` stayed empty while a ready, planned P0 existed

**What happened.** I polled `bd ready --label planned --exclude-label human --exclude-type epic`
every 60 seconds with a `bd dolt pull` between attempts, and it returned `[]` for roughly twenty
minutes after Xavier's state file showed him going `idle` at 07:55Z. Only when I gave up on
`bd ready` and ran `bd list --status=open` directly did `ah-o0d3` appear — `open`, labelled
`planned`, unassigned, priority 0, `dependency_count: 0`. Nothing about it should have been hidden
from `bd ready`. Claiming it by id with `bd update ah-o0d3 --claim` worked immediately.

**Why.** Not established. It may be a propagation delay between the Dolt remote and whatever
`bd ready` reads, or a filter interaction with `--label`; I did not isolate it, and I did not want
to spend a P0's time doing so.

**Cost.** About twenty minutes of an implementer sitting idle with a P0 waiting for it, on top of
the hours the queue was genuinely empty. Harmless here because I was idle anyway — but the failure
mode is that the fleet reports "queue empty" while urgent planned work sits unclaimed, and the
`idle` state gives the navigator no reason to look closer.

**Prevent by.** `implement-bead`'s *Picking up* poll trusts `bd ready` as the sole source of truth.
A cheap cross-check in the empty-queue branch — `bd list --status=open` filtered for the `planned`
label and no assignee, whenever `bd ready` comes back empty — would have caught this in one cycle
and named the discrepancy instead of hiding it. Whether that belongs in the skill or is worth a `bd`
bug report is the navigator's call.

**Seen before.** None found.
