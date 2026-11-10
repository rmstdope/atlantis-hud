# ah-a97xg.11 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-11-10
- **PR:** #1937

## Unit tests in the desktop shell's Rust never run, in CI or under `cargo test -p`

**What happened.** The plan put `write_assistant_file` and its tests in
`apps/desktop/src-tauri/src/assistant.rs`. `cargo test -p atlantis-hud-desktop-shell assistant`
reported "running 0 tests" and passed, the existing token tests included, until rerun with
`--features desktop-runtime`, where the new tests went red as expected.
**Why.** `assistant.rs` (and every runtime module of the shell) is gated on
`feature = "desktop-runtime"`, which is off by default. CI's `rust` job runs `cargo test --workspace`
without it; the `desktop-shell` job only runs `cargo check` and `cargo clippy` with it
(`.github/workflows/ci.yml`). So `assistant.rs`'s three token tests have never gated a merge either.
**Cost.** About ten minutes, and a plan amendment: the write moved to `crates/assistant-mcp/src/file.rs`,
which the workspace tests do cover.
**Prevent by.** A `cargo test -p atlantis-hud-desktop-shell --features desktop-runtime` step in the
`desktop-shell` job of `.github/workflows/ci.yml`, or a `.cerebro/traps.md` entry telling planners to
put testable Rust for the shell in a crate rather than in `src-tauri/src`.
**Seen before.** ah-wxk.1-verifier (the same feature gate, but for launching the dev build, not tests).

## Tooling suites time out under a full gate and pass alone

**What happened.** Two of five `pnpm run check:fast` runs failed only in the tooling leg:
`scripts/gateLock.test.ts` once, and `scripts/beadsExport.test.ts` with `scripts/runGate.test.ts` once.
Each passed when run alone, and the next full gate passed.
**Why.** Not established; the failures are process-timing assertions, consistent with this machine
serialising process launches under load.
**Cost.** Two extra gate runs, about six minutes. It also hid a slip: a push chained on the log grep
rather than the gate went out on a red gate (CI was green on it).
**Prevent by.** Raising those suites' timeouts or giving the tooling leg a retry for timing-only
failures in `scripts/runGate`; and on the producer side, push only inside `if pnpm run check:fast; then`.
**Seen before.** ah-yphv, ah-qled.10.1.

## Three rebases in one bead, each from a sibling appending to the same tool module

**What happened.** ah-a97xg.10, .1 and .2 merged while this PR was in review or CI, and each made it
`CONFLICTING`. Every conflict was two additions side by side in `assistantTools.ts` and its test file,
and each time keeping both sides dropped the closing braces the two blocks shared (`}` or
`  });\n});`), which only `tsc` caught.
**Why.** Every child of ah-a97xg adds tools to the one `ASSISTANT_TOOLS` array, the one `answer`
switch, the one `AssistantHost` interface and the one fake host in the test, all built at the same time.
**Cost.** Three rebases and three gate runs, about twenty-five minutes.
**Prevent by.** Splitting `assistantTools.ts` so a tool family lives in its own module and registers
into the list, with the test fake built from per-family parts; until then, `tsc --noEmit` straight
after resolving any keep-both conflict in that file.
**Seen before.** None found (`grep -rl "assistantTools.ts" docs/retrospectives/`).
