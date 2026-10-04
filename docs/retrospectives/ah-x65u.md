# ah-x65u — retrospective

- **Role:** bugfixer (Bishop)
- **Date:** 2026-10-04
- **PR:** #1387

## A RED that never ran looked like a RED

**What happened.** To show that a new test hung against the previous code, I wrapped the vitest run in `timeout 60 pnpm exec vitest run …`. It printed nothing and exited 1. I took that as the hang reproduced and went straight on to the fix. Afterwards a later run with no output made me check. macOS has neither `timeout` nor `gtimeout`, so the shell's "command not found" was the whole result, and the test had never run. I re-proved the RED with a background run and `kill -0` after 20 s, and the hang was real.

**Why.** `timeout` is GNU coreutils and is not on this Mac. My `grep` filter on the output swallowed the "command not found" line, and exit 1 looked the same as a failing test.

**Cost.** Small this time, about five minutes. But a reproduction claim in the PR almost rested on a test that never executed, which is the one thing the bug-fix contract exists to prevent.

**Prevent by.** In `fix-bug`, contract step 3, require that the RED run's output names the test as failed (vitest's `×` line, or a named failure) before the fix starts. An exit code alone is not enough. To bound a hanging run on macOS, run it in the background and check with `kill -0` after a sleep, not with `timeout`.

**Seen before.** None found.
