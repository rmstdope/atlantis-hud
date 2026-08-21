# ah-qled.7.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-22
- **PR:** #538 (and rmstdope/cerebro#81)

## A conf key added on a branch has no effect until it merges, so the gate could not exercise it

**What happened.** This bead moves the fleet's disk floor into
`.claude/cerebro-project.conf` as `disk_floor_gb`, and `scripts/runGate.ts` now spawns
`.claude/cerebro/scripts/disk-preflight` to report it. The declaration was added and committed on
the bead's branch, in the bead's own worktree — and `pnpm run check:fast` then printed
`disk: the preflight said nothing.`, which is exactly what a project declaring **no** floor is
supposed to see. Running the script by hand with `FREE_SPACE_FLOOR_GB=8` reported free space, the
floor and the reclaimable trees correctly, so nothing was broken.

**Why.** Established. `scripts/project-conf` resolves the conf through
`consumer-root --shared`, deliberately: "the fleet's configuration is one answer for the checkout,
not one per worktree". A worktree therefore reads the **main checkout's** committed conf, not its
own — so a key a branch adds is invisible to every command run from that branch, including its
gate, until the branch merges.

**Cost.** About ten minutes, all of it diagnosis, and it could have been much worse: the natural
reading of `the preflight said nothing` is that the new script is broken, and chasing that would
have meant debugging a script that was working perfectly.

**Prevent by.** `implement-bead`'s *Building* section could say it in one line: **a key added to
`.claude/cerebro-project.conf` on a branch does not take effect until the branch merges, because
`project-conf` reads the shared checkout — verify it by passing the value in the environment
instead.** Every `cerebro-project.conf` key is env-overridable or has a `[default]` argument, so
there is always a way to exercise the post-merge behaviour from a branch. This affects any bead in
the `ah-qled` family, which is all about moving facts into that file.

**Seen before.** ah-qled.1 and ah-qled.4 are the only retrospectives naming `project-conf` or
`cerebro-project.conf`, and neither describes this — ah-qled.1's first finding is the adjacent but
different trap that the file was *git-ignored*. So: none found for this one.
