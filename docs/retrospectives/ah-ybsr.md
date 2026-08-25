# ah-ybsr — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-25
- **PR:** #154 (rmstdope/cerebro), bump PR (atlantis-hud)

## Picking up has no documented step for resuming a bead already claimed under your own name

**What happened.** My first turn started with no memory of any prior work: no
`.cerebro/state/Storm.state.json` existed, and `bd ready` returned an empty list. Before concluding
the queue was empty and starting the wait loop, I checked `bd list --status=in_progress` and found
`ah-ybsr` already `in_progress`, assigned to `Storm`, with an unexpired lease — and a worktree at
`.cerebro/worktrees/ah-ybsr` already carrying four committed increments in the `.claude/cerebro`
submodule checkout, plus one increment's test and implementation written but not yet committed. A
prior `Storm` session had evidently been building this bead and ended (a host restart, most likely)
without writing `done` or leaving a state file behind.

**Why.** Not established — I have no visibility into why the previous session ended without a
final state-file write. What is established is that `implement-bead`'s *Picking up* section has no
step for this case: it opens straight into checking `bd ready` for planned work and, failing that,
polling an empty queue. There is no instruction to check whether the agent's own name already holds
an `in_progress` bead before assuming there is nothing to resume, and no documented procedure for
reconstructing progress once one is found — I had to work it out myself: `bd show --json` for the
plan, `git log --oneline` in the submodule checkout against the plan's numbered increments to see
which had landed, and `git diff`/`git status` to find the one increment that was written but
uncommitted.

**Cost.** Perhaps ten minutes of investigation (`bd list`, `bd show`, worktree and submodule `git
status`/`git log`/`git diff`) to establish what had already been done before I could safely continue
— not large, but it was reconstructed from first principles rather than following a documented
recovery step, and it would recur identically for any implementer whose session ends mid-bead
without a clean `done`.

**Prevent by.** `implement-bead`'s *Picking up* section could add a check, before the `bd ready`
poll, for a bead already `in_progress` and assigned to the agent's own name
(`bd list --status=in_progress --assignee=<name>`), with a short recovery recipe: read the plan's
increments from `bd show --json`, check the existing worktree's commit log against them to find
where the run stopped, and check for uncommitted-but-complete work before starting the next
increment fresh. That would turn an ad-hoc reconstruction into a repeatable step.

**Seen before.** none found.
