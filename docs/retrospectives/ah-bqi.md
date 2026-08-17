# ah-bqi — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-17
- **PR:** rmstdope/cerebro#51, and the gitlink bump in this repository

## `tests/launchers.sh` fails locally for whatever this machine's `.cerebro/models.conf` says

**What happened.** The bead's validation is `for t in tests/*.sh; do bash "$t"; done` from the
submodule root. Four suites passed; `tests/launchers.sh` failed with
`FAIL: launch Xavier: expected --effort high, got: BEADS_ACTOR=Xavier`. It failed identically with my
own changes stashed, and CI was green on the same commit of main.

**Why.** Established. `scripts/launch` reads `<consumer>/.cerebro/models.conf` and honours it over
the agent file's frontmatter, and this machine's file says `planner opus medium`. The suite asserts
the frontmatter's `--effort high`. CI has no consumer repository above the submodule, so the file
does not exist there and the suite is right to pass. The failure is the override working.

**Cost.** About ten minutes, all of it spent deciding whether a red suite in a bead touching
`scripts/` was mine. Two runs (stash, unstash) plus a `gh run list` against the submodule's main to
confirm CI's view.

**Prevent by.** Either the suite neutralises the consumer's file — run its `launch` cases with a
`.cerebro/models.conf` it controls, or with an env var that makes `scripts/launch` ignore one, the
way `tests/agent-state.sh` builds a whole throwaway consumer rather than reading the real one — or
`tests/launchers.sh` names the trap in its header so a reader knows the failure before running it.
The first is better: a suite whose result depends on an uncommitted, per-machine file cannot be part
of a documented validation step, and this is now the fourth separate retrospective about running
this one suite locally.

**Seen before.** `ah-rnz.md` (wrong `bash` on the PATH), `ah-cuc.md` (a consumer fixture's
symlinks), `ah-goz.md` (red on the HEAD it was run against), `ah-2sy.md` (run from inside a
worktree's own submodule copy) — four different causes, one suite, all of them "it fails here and
passes in CI".

## The plan's own validation grep contradicted the prose the plan asked for

**What happened.** The plan's *Validation* required `grep -rn 'kill -0' .` to print nothing, and its
*Files to change* required a sentence in `skills/plan-bead/SKILL.md` explaining why a bare `kill -0`
is wrong there — naming it, which is what makes the sentence useful. Both cannot hold.

**Why.** Established: the grep was written as "no `kill -0` remains as a liveness test" and
implemented as "the string does not occur", which the plan's own required prose then violates.

**Cost.** Small — a few minutes, and a paragraph in the PR body recording the deviation.

**Prevent by.** A plan that asks for prose naming the construct it is removing should scope the
mechanical guard to code, not to the file set: `grep -rn 'kill -0' --include='*.sh' scripts tests`,
or a grep over the fenced bash blocks. Worth watching for generally: a "must print nothing" check in
a plan is cheap to write and easy to make contradict the same plan's documentation work.

**Seen before.** None found.
