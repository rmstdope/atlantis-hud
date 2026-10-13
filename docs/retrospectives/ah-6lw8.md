# ah-6lw8 — retrospective

- **Implementer:** Bishop
- **Date:** 2026-10-14
- **PR:** #1566

## A bug bead was already fixed on main when it was claimed

**What happened.** The bead was filed at 22:01 (+02) on 2026-10-13, during the cold review of ah-msds. ah-9udi (#1563) merged at 23:32 and fixed the cause through `SharerStock::at`'s reading of `Ledger::gift_draws`. The bead was claimed afterwards. Its reproduction test passed on the first run. Only running it against the old orders/ sources of 20a1479f and 5d33f0e9 showed that it did reproduce the defect, and that main had already fixed it. During that run, the worktree's index briefly held old copies of orders/, which a peer session (Cyclops) saw and mistook for a revert. The reviewer's run against pre-fix main in a scratch worktree shared this tree's `target/`, and cargo reused the pre-fix binary for the head run until `cargo clean -p` was run.

**Why.** Nothing links a bead filed off a review finding to the beads fixing neighbouring code. ah-9udi touched the same reader, and nobody re-ran ah-6lw8's example once it merged.

**Cost.** A full bead cycle (bisecting the test, gate, review, two CI runs) for a test-only PR. A cross-session false alarm.

**Prevent by.** In `fix-bug`, *The bug-fix contract* step 3: when a new reproduction test passes on first run, bisect it with `git log origin/main -- <file>` against the last few commits that touched the file, in a scratch worktree with its own `CARGO_TARGET_DIR`, never by checking old files out into the bead's own index.

**Seen before.** ah-zh5i.4, ah-yw4p (a symptom already gone from main when the work started).
