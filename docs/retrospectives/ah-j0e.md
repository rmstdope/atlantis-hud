# ah-j0e — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #362

## `bd ready --claim` on a reopened bead left status `open`, so the first several heartbeats failed

**What happened.** `bd ready --label planned --exclude-label human --exclude-type epic --claim
--json` returned `ah-j0e` (reopened by Psylocke's failed verification, `verification:failed`
label) with `"assignee": "Storm"` — the claim looked like it had taken. But `"status": "open"`,
not `"in_progress"`. Every `bd heartbeat ah-j0e` afterward failed with `issue not claimable:
ah-j0e status open` (seen 8 times over about 4 minutes while waiting on the Copilot review).
Running `bd update ah-j0e --claim` again set status to `in_progress` and heartbeats succeeded
from then on.

**Why.** Not established. Plausibly something about a `verification:failed`-labelled, reopened
bead makes the atomic claim in `bd ready --claim` assign without transitioning status, where an
ordinary `bd update <id> --claim` on the same bead does both. Not confirmed against `bd`'s
source.

**Cost.** No bead time lost — the assignee was already correct and nothing else depended on the
lease during that window — but the lease was not actually being renewed for several minutes,
which on a busier fleet could have looked like an abandoned claim to another agent's `bd
reclaim`.

**Prevent by.** After `bd ready --claim` picks up a bead, `beads-workflow` or `implement-bead`'s
*Picking up* section could add: confirm `status` in the claim's own JSON output reads
`in_progress`, and if not, run `bd update <id> --claim` once more before proceeding — cheap
insurance against relying on a heartbeat that will silently fail.

**Seen before.** none found.
