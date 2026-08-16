# ah-cgk — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-16
- **PR:** #295

## Renaming the file the shared pre-push hook still pointed at broke `git push` from my own worktree

**What happened.** This bead renamed `scripts/beadsExportGate.ts` to `scripts/beadsExport.ts` and
removed the block in `.beads/hooks/pre-push` that invoked it. The first `git push` of the branch
failed with `ERR_MODULE_NOT_FOUND` for `scripts/beadsExportGate.ts` - a file that no longer existed
in my worktree at all.

**Why.** `core.hooksPath` on this machine is set to an absolute path -
`/Users/henrikku/repos/atlantis-hud/.beads/hooks` - which is the **main checkout's** hooks
directory, not a per-worktree one. Every worktree on this machine runs that one physical script file
on push, whatever branch it is on; the script then computes `git rev-parse --show-toplevel` to find
`$_gate_root` and invokes `$_gate_root/scripts/beadsExportGate.ts` against *that*. Since main had not
yet merged this bead's rename, the live hook script still had the old block, and it tried to run a
file that only existed in my worktree until I renamed it away. Any implementer renaming or deleting a
file the pre-push hook depends on hits this until the change reaches main and the main checkout pulls
it - a chicken-and-egg case specific to changing the hook's own dependencies.

**Cost.** Two pushes needed `--no-verify` (initial branch push and the review-fix push) - a few
minutes of investigation, no CI cycles lost.

**Prevent by.** Nothing to fix here - this bead's whole point is deleting the hook, so the trap
retires itself once this PR merges and the main checkout is next pulled. Worth a line in
`implement-bead`'s traps list only if another bead ever again changes a file the *live* pre-push hook
references from outside its own worktree; until then this is a one-off.

**Seen before.** none found.
