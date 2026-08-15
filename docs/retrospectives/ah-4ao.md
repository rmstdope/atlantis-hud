# ah-4ao — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-15
- **PR:** rmstdope/cerebro#9 (submodule), consumer bump PR follows this one

## A guard the plan's own function spec left out was found only by running the code against the live repo

**What happened.** The plan's `cerebro--claim-finding` spec said to offer `reclaim` for a claim
whose `assignee` was not among the fleet's live implementer names. Implemented literally, it worked
in every unit test — but running `cerebro--gather-sweeps` against the real atlantis-hud `.beads`
database (not a fixture) surfaced that it offered `reclaim` on `ah-4ao` itself, the bead this very
build was delivering, because this session's assignee reads as `Henrik Kurelid` (`BEADS_ACTOR` was
unset in this launch) rather than a roster name. `agents/orchestrator.md`, which the plan cites as
the source of the guard, is explicit that the test is an *expired lease*, not an unfamiliar
assignee — a human-held claim is exactly as legitimate as a roster one. Fixed by adding
`lease_age_min` to `sweep-claims.sh`'s output (from `lease_expires_at`, mirroring `bd reclaim --id
<id> --older-than 10m`'s own window) and keying the `reclaim` branch on that instead of on roster
membership.
**Why.** The plan's docstring for `cerebro--claim-finding` summarized the guard as "assignee not in
LIVE-NAMES" — a correct restatement of *when a roster session is gone*, but not of *when a claim is
dead*, which is what `orchestrator.md`'s own prose actually specifies two sections earlier. Unit
tests built from the same summary could not catch the gap, because they encoded the same assumption
the summary made.
**Cost.** About 20 minutes: writing a throwaway end-to-end check against the live `.beads` database
(copying the two new scripts and the elisp into the mounted submodule, calling
`cerebro--gather-sweeps` from `emacs --batch`, then removing the copies), finding the false
positive, and adding the `lease_age_min` field plus the guard and its test.
**Prevent by.** For any bead whose plan restates a guard from a cited prose source
(`agents/orchestrator.md` here), read the cited section itself rather than trusting the plan's
restatement, and validate the built decision function against real data from the system it is meant
to guard — not only against unit fixtures — before treating a "no path reaches a destructive command
without the guards" acceptance criterion as met. A fixture-only pass would have shipped this.
**Seen before.** None found (`docs/retrospectives/` had no prior entries).

## A fresh implementer worktree does not carry an initialized submodule

**What happened.** After `git worktree add ... origin/main`, running `git fetch`/`git checkout`
inside `.claude/worktrees/ah-4ao/.claude/cerebro` silently operated on the *outer* atlantis-hud
repository instead of the cerebro submodule — `git remote -v` there showed
`rmstdope/atlantis-hud.git`, and the commit log was atlantis-hud's, not cerebro's. `git worktree
add` does not run `git submodule update --init`, so the directory was not yet a git repository at
all, and every git command inside it walked up to the enclosing worktree instead of erroring.
**Why.** `git worktree add` intentionally does not initialize submodules (matching plain `git
clone`'s behaviour without `--recurse-submodules`); nothing here runs `git submodule update --init`
for a worktree the way `CLAUDE.md`'s onboarding block does for a fresh clone.
**Cost.** About 5 minutes of confused output before `git rev-parse --show-toplevel` revealed the
directory was not a submodule checkout at all.
**Prevent by.** Any bead whose implementation touches `.claude/cerebro` from a *new* worktree should
run `git submodule update --init --recursive` right after `pnpm install`, before touching anything
under `.claude/cerebro` — the same command `CLAUDE.md` already documents for a fresh clone applies
equally to a fresh worktree, and the workspace preflight/skill text does not currently say so.
**Seen before.** None found.
