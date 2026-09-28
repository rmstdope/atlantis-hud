# ah-bwxp.1 — retrospective

## A gate started with `&` inside a waiting Bash call died with the call, and the next gate failed typecheck with no error

**What happened.** I started `pnpm run check:fast` with `( … ) &` inside a foreground Bash call whose
`until` loop waited on the gate's log. The tool call ended with exit code 144, and its SIGTERM
reached the backgrounded gate: the log stops at `could not compile schemars … (signal: 15,
SIGTERM)`. The gate I then started with the tool's own `run_in_background` reported
`typecheck FAIL` with no error anywhere in its output. `pnpm run typecheck` alone exited zero
straight afterwards, and a third `check:fast` was fully green.

**Why.** The first part is established: a job started with `&` belongs to the tool call's process
group, so it dies when the call is killed. Why the second gate's typecheck failed is not
established. Its `cargo check --workspace` ran while the killed gate's cargo processes may still
have been exiting, and it logged "Blocking waiting for file lock on package cache".

**Cost.** Two extra fast-gate runs, about ten minutes.

**Prevent by.** `produce-bead`, *Waiting, without ending your run*: say that a long local command
(the gate) is started with the Bash tool's `run_in_background`, never with `&` inside a
foreground call, and that the wait is a separate call polling its output file.

**Seen before.** `ah-af7i.md`, "`check:fast`'s typecheck leg failed once and passed on a re-run
with no change". That one had no killed process, so contention between legs is still a suspect.
