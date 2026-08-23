# ah-7cdt (reopened) — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #585

## A reopened bead cannot be claimed: the assignee survives the reopen

**What happened.** `bd ready --label planned` offered ah-7cdt (reopened at P0 by Psylocke) as the
only ready bead, but `bd update ah-7cdt --claim` refused with *"already assigned to Cyclops"*. The
bead was `status: open`, `lease_expires_at: null`, and `.cerebro/state/Cyclops.state.json` had read
`idle`/`bead: null` for seven hours — no live claim by any measure. `bd unclaim` refused for the same
reason, and `bd reclaim --id ah-7cdt --older-than 10m` reported *"No stale leases to reclaim"*,
because there is no lease left to be stale. Only `bd unclaim --force` got past it, which needs the
navigator's approval, so the bead sat while I asked.
**Why.** Reopening a bead clears `status` and `closed_at` but leaves `assignee` set to whoever last
built it. bd's claim guard keys off `assignee`, and its recovery path (`bd reclaim`) keys off lease
expiry — so a bead with an assignee and no lease falls between the two and is unclaimable without
`--force`.
**Cost.** About four minutes, and one navigator interruption at the very first step of the run — the
step `implement-bead` describes as needing nothing from anybody.
**Prevent by.** Whoever reopens a bead should clear its assignee in the same operation — that is
Psylocke's reopen path, and the verifier agent's reopen step is where the `bd unclaim --force` (or an
`--assignee ''`) belongs. Failing that, `implement-bead`'s *A reopened bead* section should name this
state and say that a stale assignee with no lease and an idle holder is the one case `--force` is
for, so the next implementer recognises it rather than diagnosing it from scratch.
**Seen before.** none found — `ah-m9q.2.md` is about two live claims on one bead, the opposite
problem, and `ah-3cs.md` is about verification timing rather than the claim.
