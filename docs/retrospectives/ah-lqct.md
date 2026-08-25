# ah-lqct — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-25
- **PR:** #693

## The disk floor blocked the start again, the sanctioned reclaims were refused again, and the bead needed none of it

**What happened.** `disk-preflight` refused the start: 4.4 GB free against an 8 GB floor. It named
three "always safe" offline reclaims (`~/.cargo/registry/src`, `target/debug/incremental`,
`~/Library/Caches/Mozilla.sccache`), and the `rm -rf` of those three was refused by the harness
permission classifier — as was, on the first attempt, the very next `agent-state` call. I put the
choice to the navigator, who said proceed; the whole bead then ran on the 4.4 GB, `pnpm run
check:fast` (cargo clippy and a fresh worktree install included) and all of CI green, with nothing
reclaimed.

**Why.** Two established causes, neither new: the floor is a single number that does not know a
bead's diff is TypeScript-only in `packages/shared`, and the two `$HOME` reclaims the tool advertises
sit outside the project directory the classifier will let an implementer delete from.

**Cost.** About ten minutes and one navigator interruption, on a bead that would otherwise have run
unattended end to end.

**Prevent by.** This is now at least its seventh sighting, and each retrospective has recorded the
same two facts. Either the tool should stop advertising reclaims an implementer cannot run, or the
floor should be conditioned on what the run will actually build — but the change is in
`.claude/cerebro/scripts/disk-preflight`, outside any planned bead, so it stays the navigator's.

**Seen before.** `ah-y3j1`, `ah-udff`, `ah-deo5`, `ah-tdsi`, `ah-9r0`, `ah-awcm` — the same floor,
the same two unusable reclaims, and in three of them the bead completed fine below the floor.
