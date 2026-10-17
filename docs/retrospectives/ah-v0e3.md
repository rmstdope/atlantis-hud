# ah-v0e3 retrospective

- **Implementer:** Cyclops
- **Date:** 2026-10-17
- **PR:** #1716

## `bd heartbeat` blocked for minutes and held up the phase change chained after it

**What happened.** After the refactor commit, one Bash call chained `git commit && bd heartbeat
ah-v0e3 && agent-state ... --phase gate && build-workload --classify`. The commit landed, then
`bd heartbeat` sat with no output past the tool's 120 s timeout, so the call was moved to the
background with the state file still at `build`. `pgrep` showed the `bd heartbeat` process alive
alongside other fleet sessions' `bd` commands; killing it and carrying on worked, and later
heartbeats, run in the background, never blocked anything.

**Why.** Not established. Several fleet sessions were writing to the bead database at the same
moment (Cerebro's `bd update`, Psylocke's verification), so lock contention on the local Dolt store
is the likely cause, but nothing printed confirms it.

**Cost.** About three minutes, and a state file that showed the wrong phase meanwhile.

**Prevent by.** `produce-bead`, *Waiting, without ending your run* and the state-file contract: put
`bd heartbeat` in its own call, or background it (`(bd heartbeat <id> >/dev/null 2>&1 &)`), and never
`&&`-chain a state write or a gate after it, so a stuck heartbeat cannot hold up the work it was
meant to cover.

**Seen before.** No earlier retrospective names a hung `bd heartbeat`.
