# ah-yvf — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** cerebro#33, atlantis-hud#299

## A session's own CLAUDE.md was two commits stale, and its worktree ended up in a location `main` no longer used

**What happened.** My session started from the main checkout at `deba9d5`, two commits behind
`origin/main`. Its `CLAUDE.md` (loaded into my system prompt at session start, from that checkout)
still said "ALWAYS branch in a worktree of your own under `.claude/worktrees/`". I fetched
`origin/main` and branched from it as instructed, but built the worktree at
`.claude/worktrees/ah-yvf` per that stale instruction. `origin/main`'s tip, `4c718d8`
(ah-v82, already merged before I claimed this bead), had moved the convention to
`.cerebro/worktrees/` — its own `CLAUDE.md`, present in the branched-from commit, already said so.
`pnpm run check:fast` then failed `scripts/cargoTargetDir.test.ts`'s
`strayWorktrees` check, which treats anything not under `.cerebro/worktrees/` as stray, because my
own worktree was sitting in the location the check now flags.
**Why.** The main checkout the session started in was behind `origin/main`, and nothing refreshes a
session's own `CLAUDE.md`/skill text mid-session from a later commit — it is read once, at start.
The bead's plan and the `implement-bead`/`beads-workflow` skill text I loaded also both still said
`.claude/worktrees/`, for the same reason: they are symlinks into the `.claude/cerebro` submodule,
pinned to whatever commit the checkout I started in was pinned to.
**Cost.** About 10 minutes: `git worktree remove --force` the misplaced tree, `git worktree add` it
again under `.cerebro/worktrees/`, reinitialize the submodule, `pnpm install`, and rerun
`check:fast` (which had failed once already, red on the stray-worktree check).
**Prevent by.** Nothing here to change in the workflow itself — `git fetch origin main` before
branching is already the rule, and it was followed. What would have caught this earlier is running
`git worktree list` right after creating the worktree and comparing it against what the
just-fetched `origin/main`'s own `CLAUDE.md` says, rather than trusting the session's own (possibly
stale) copy for a path convention that had just changed underneath it.
**Seen before.** None found (`grep -rl "\.claude/worktrees\|stale" docs/retrospectives/` turned up
hits on unrelated staleness, not this one — the worktree-location move itself is new with ah-v82).
