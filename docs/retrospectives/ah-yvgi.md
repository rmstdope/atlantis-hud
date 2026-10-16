# ah-yvgi — retrospective

## Another session's `pkill -f "pnpm run check:fast"` killed this session's fast gate

**What happened.** The fast gate (`pnpm run check:fast`) was running in this worktree when it died
with exit 144 partway through `cargo test --workspace`. `pgrep` showed another session's command
line: `pkill -f "pnpm run check:fast" ; cargo fmt && ... pnpm run check:fast > .../gate3.log`. That
pattern matches every session's gate on the machine, not only the caller's own.

**Why.** `pkill -f` matches the whole command line of every process the user owns, and all fleet
sessions run the same gate command as the same user, so a session clearing out "its" stale gate
clears out everyone's.

**Cost.** One gate run, about ten minutes, and a confusing exit 144 to diagnose. Worked round by
running `pnpm check:fast` (without `run`), which the pattern did not match.

**Prevent by.** `produce-bead` *Building* (and `fix-bug` through it): say never to stop a gate with
`pkill -f` on the command text, and to stop one's own run by the pid it was started with (or by a
pattern that includes the session's own worktree path).

**Seen before.** Nothing like it yet in `docs/retrospectives/`.
