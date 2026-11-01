# ah-dgogb — every bd call blocked for minutes behind another session's `bd dolt push`

**What happened.** Right after writing the plan, `bd update ah-dgogb --design-file … && bd dolt push
&& agent-state … --phase build && bd heartbeat` hit the 120 s tool timeout and went to the
background, and a later `bd show` did the same. `ps` showed why: Cerebro's `bd dolt push` had been
running for minutes, and its `git push` of `refs/dolt/data` to GitHub was still sending. Every
local `bd` call, reads included, waited for it, about six minutes in all. When the chain finally ran, its
`agent-state … --phase build` landed after I had already moved to `gate`, so my state file showed a
phase I had left until I rewrote it.

**Why.** A `bd dolt push` holds the local Dolt database for its whole remote transfer, and every
session on this machine shares that database. A slow push from any session stalls `bd` for all
of them. Not established: why that push was so slow.

**Cost.** About six minutes of `bd` being unavailable (worked around by doing validation that
needed no `bd`), and a stale state write that would have shown the fleet view the wrong phase.

**Prevent by.** In `produce-bead`, *State file*: never chain `agent-state` after a `bd` command in
one call. Write the state first, on its own, so a blocked `bd` cannot write it late. When `bd`
does not answer, check `ps` for a running `bd dolt push` before suspecting the bead.

**Seen before.** No: nothing in `docs/retrospectives/` mentions `bd` blocking behind a push.
