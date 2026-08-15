# ah-cuc — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-15
- **PR:** cerebro#23, atlantis-hud#273

## A path comparison against `git rev-parse --show-toplevel` failed under mktemp, because macOS resolves symlinks and a plain `pwd` does not

**What happened.** `scripts/ensure-symlinks`'s test in `tests/launchers.sh` — a consumer repo built
under `mktemp -d` — failed its guard even though the consumer layout was correct: the script computed
`consumer` with `cd "$parent/.." && pwd` and compared it to
`git -C "$consumer" rev-parse --show-toplevel`, and the two never matched. `bash -x` showed why:
`mktemp -d` on this machine returns a path under `/var/folders/...`, which is itself a symlink to
`/private/var/folders/...` (macOS's `/tmp` → `/private/tmp` is the same symlink). `git rev-parse
--show-toplevel` always resolves symlinks in the path it prints; plain `pwd` after a `cd` does not.
**Why.** `pwd` without `-P` prints bash's tracked logical `$PWD`, which preserves whatever symlink
component was used to `cd` into a directory. `git rev-parse --show-toplevel` resolves the repository
root physically. Any script that builds a path with `cd ... && pwd` and then compares it against git's
output needs `pwd -P` on its own side, or the comparison is only accidentally correct on filesystems
without a symlinked temp directory.
**Cost.** About 10 minutes: one failing test, one `bash -x` trace to find the mismatched paths, one
one-line fix (`pwd` → `pwd -P` in `scripts/ensure-symlinks`).
**Prevent by.** Nothing in this repository to change — the fix is already in `scripts/ensure-symlinks`
(`pwd -P`, with a comment explaining why). Worth knowing for the next script anywhere in this fleet
that compares a shell-built path against `git rev-parse --show-toplevel` (or any other git command
that resolves symlinks): use `pwd -P`, not `pwd`, on the shell side of the comparison.
**Seen before.** None found (`grep -rl "pwd -P\|show-toplevel" docs/retrospectives/` before this file
turned up nothing on this specific mismatch — ah-4ao's hit on `show-toplevel` is a different problem,
a worktree missing its submodule checkout).
