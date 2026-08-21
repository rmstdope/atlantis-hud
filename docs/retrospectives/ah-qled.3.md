# ah-qled.3 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-21
- **PR:** rmstdope/cerebro#73, and the pin bump here

## An absolute `--path` from `mktemp -d` is refused by `prepare-worktree` on macOS

**What happened.** The new `tests/prepare-worktree.sh` passed
`--path "$work_dir/.cerebro/worktrees/ah-1"`, with `$work_dir` from `mktemp -d`, and the script
refused: *"is not under .cerebro/worktrees/ - worktrees live there, never elsewhere"*. It plainly
was.
**Why.** Established. On macOS `mktemp -d` returns a `/var/folders/...` path, while
`scripts/consumer-root` resolves with `pwd -P` and gets `/private/var/folders/...`. The prefix
comparison in `prepare-worktree` compares the two forms literally, so it never matches. Nothing to
do with the branch resolution being tested; the message names a cause that is not the cause.
**Cost.** About ten minutes, and one wrong diagnosis before the second look at the path strings.
**Prevent by.** Cerebro tests that fabricate a consumer under `mktemp -d` should pass the
**relative** `--path` form (`.cerebro/worktrees/<id>`), which `prepare-worktree` accepts and which
sidesteps the question. A note to that effect belongs next to the path-normalisation block in
`scripts/prepare-worktree` (around its `case "$path" in` at :75), which is where somebody hitting
this will look. Whether the script should resolve the caller's path with `pwd -P` before comparing
is a real question, but it is a change to that script's contract and so the navigator's, not a
planned bead's.
**Seen before.** None found — `grep -rl "private/var\|mktemp" docs/retrospectives/` matched only
`ah-cuc.md`, which is about something else.

## The plan's assumption about this consumer's `origin/HEAD` was wrong, harmlessly

**What happened.** The plan's validation step 1 said this consumer's branch *is* `main` and
`origin/HEAD` resolves, so no `default_branch` key is needed. `scripts/default-branch` on this
checkout answers `main` — but by the last-resort step, reporting
*"no declaration and no origin/HEAD -> main"*: `refs/remotes/origin/HEAD` is not set here.
**Why.** Established, and ordinary: `git clone` sets `origin/HEAD`, a remote added with
`git remote add` does not, and this checkout is in the second state. The resolver already treats
that as the common case and falls through quietly, which is why the answer is right anyway.
**Cost.** Nothing beyond noticing it — the conclusion (no key needed here) is unchanged.
**Prevent by.** Worth knowing rather than fixing: a future bead that reasons about detection on
*this* repository should check with
`git symbolic-ref refs/remotes/origin/HEAD` rather than assuming a clone set it. Running
`git remote set-head origin -a` here would make detection real, but that is a change to the
navigator's own checkout and not a planned bead's to make.
**Seen before.** None found.
