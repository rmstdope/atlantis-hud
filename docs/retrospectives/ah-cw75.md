# ah-cw75 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** #675

## `prepare-worktree` reported a successful install, but the worktree had no `node_modules`

**What happened.** `prepare-worktree` finished with what looked like a completed install — its
last lines were `+ typescript 5.9.3`, `+ vitest 3.2.7`, `Done in 5s`. The first `pnpm run
check:fast` in that tree then failed immediately with `sh: tsx: command not found` and
`WARN Local package.json exists, but node_modules missing`. `ls node_modules` confirmed the
directory did not exist at all. A plain `pnpm install --frozen-lockfile` in the tree took 2.6s
and fixed it; the gate passed on the next run.

**Why.** Not established. The install pnpm reported and the tree the gate ran in disagreed, and I
did not determine whether the script installed somewhere else, was interrupted after printing its
summary, or hit a pnpm store/link step that silently produced nothing. The `Done in 5s` against a
2.6s re-run suggests the first invocation did do work.

**Cost.** One failed gate run and one install, about three minutes. Small, but the failure names
`tsx`, which reads as a project/toolchain fault rather than a missing install, and an implementer
that took it at face value could lose much longer to it.

**Prevent by.** `prepare-worktree` asserting what it claims before it returns — a check that the
tree's `node_modules` exists (and its declared runner resolves) after running the project's
`install`, failing loudly there rather than letting the first gate run report it as `tsx: command
not found`. The script is in `.claude/cerebro/scripts/`, so this is the navigator's change, not a
bead's.

**Seen before.** None found — no retrospective here mentions `tsx: command not found` or a missing
`node_modules`.
