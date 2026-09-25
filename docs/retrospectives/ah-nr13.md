# ah-nr13 — retrospective

- **Implementer:** Bishop
- **Date:** 2026-09-25
- **PR:** #1312

## The fast gate skipped its disk preflight

**What happened.** `pnpm run check:fast` reported `spawnSync .../.claude/cerebro/scripts/disk-preflight ENOENT` and then continued to run every gate.
**Why.** Not established.
**Cost.** The full gate still passed, but it did not verify the prerequisite intended to prevent Rust builds failing on a full disk.
**Prevent by.** Make `scripts/runGate.ts` fail `check:fast` when its disk-preflight launcher cannot start.
**Seen before.** none found.
