# ah-a7e2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-25
- **PR:** #694

## The disk floor's advertised reclaims are arithmetically too small to clear it

**What happened.** `disk-preflight` refused the bead at 5.8 GB free against the 8 GB floor, and named
its three always-safe reclaims: `~/.cargo/registry/src`, `target/debug/incremental` and
`~/Library/Caches/Mozilla.sccache`. `rm -rf` on the two `$HOME` paths was denied by the harness
classifier, as `ah-udff` already records. The new datum is that it would not have mattered: the two
are **235 MB and 233 MB**, and `target/debug/incremental` did not exist. The advertised reclaims
total under 0.5 GB against a **2.2 GB shortfall** — they cannot clear the floor even when they are
permitted to run. `prune-worktrees.sh` correctly kept the only other tree (Psylocke's).

**Why.** Established. The reclaim list is a fixed list of safe paths, not a set chosen to meet the
shortfall, and nothing compares their size to the gap before printing them as the way forward.

**Cost.** About four minutes and, more expensively, **one navigator interruption** — the same cost
`ah-deo5` records. They chose "proceed anyway", which was right: the bead's diff is one markdown file
and one deleted YAML line, and `check:fast` passed in under two minutes against a warm `target/`.

**Prevent by.** Two things, both in `.claude/cerebro/scripts/disk-preflight`, and both the
navigator's to decide:
1. **Size the reclaims against the shortfall before offering them.** If they cannot close the gap,
   say so in the same breath rather than presenting them as the remedy — a reader spends minutes on
   them otherwise.
2. **Let the floor know what the bead will build.** The 8 GB floor is documented in
   `.cerebro/project.conf` as one fresh worktree's worst-case Rust build plus the build the bead is
   about to run. A docs-only bead runs neither. A preflight that could be told "this diff touches no
   `app_paths`" would not have stopped this bead at all, and eight retrospectives now say the floor's
   false positives are its main cost.

**Seen before.** `ah-udff` (the same two `$HOME` reclaims cannot be run), `ah-deo5` (the floor cost a
navigator interruption), `ah-cxxa` (tripped with no reclaim available at all), `ah-tdsi`, `ah-y3j1`,
`ah-9r0`, `ah-hlqc` (45 minutes waiting), `ah-8m0.2`. This is the ninth.
