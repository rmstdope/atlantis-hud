# ah-k6i.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-15
- **PR:** #278

## A `nohup ... &` background command does not survive past the end of its `Bash` tool call

**What happened.** `pnpm run check` aborted at the tooling suite for an unrelated reason (a stray
sibling worktree — see the known trap and `ah-sup`'s retrospective), so I ran the remaining gate
steps by hand: `pnpm run test:smoke && pnpm run build:web && pnpm run test:pwa && cargo fmt --check
&& cargo clippy ...`, backgrounded with `nohup ... > log 2>&1 &` inside one `Bash` call so a second
call could poll `kill -0 <pid>` and heartbeat while it ran, following this skill's *Waiting, without
ending your run* pattern but adapted for a single long-running command rather than a condition to
poll. The first poll call reported the process still running for several iterations and showed
real, advancing output (smoke, build, pwa all completed and logged). The *next* `Bash` call's
`kill -0` immediately reported the pid gone, and the log stopped mid-`cargo clippy` with no error,
no exit message, and no further output — `cargo fmt --check` had apparently run (its result showed
up when re-run) but never printed to the log either.

**Why.** Not fully established, but the evidence points at the harness ending the background
process when the `Bash` tool call that started it returns, `nohup` notwithstanding — plausibly a
process-group teardown between tool calls rather than a true shell exit. This is different from the
`Monitor`/`run_in_background` re-invocation gap this skill already warns about: that gap is about
never being woken up; this one silently kills work already in flight partway through, with no error
signal at all — the log just stops.

**Cost.** About 5 minutes: `cargo fmt --check` and `cargo clippy` had to be re-run as two ordinary
foreground `Bash` calls (each easily under the 10-minute ceiling once smoke/build/pwa's build
artifacts were already warm), which is where they should have gone in the first place.

**Prevent by.** For a single long-running gate command that does not fit one foreground `Bash` call
under the 10-minute ceiling, split it into its own sequential foreground calls per step (as the gate
already separates lint/typecheck/test/smoke/build/pwa/fmt/clippy) rather than backgrounding the
whole chain with `nohup ... &` and polling — the polling pattern in *Waiting, without ending your
run* is for waiting on an external condition (a review, CI), not for keeping a local command alive
across tool-call boundaries.

**Seen before.** None found.
