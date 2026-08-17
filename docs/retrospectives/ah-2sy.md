# ah-2sy — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** cerebro#49, plus an atlantis-hud submodule-bump PR (per the bead's two-repository plan)

## `tests/launchers.sh` failed only when run from inside a real implementer worktree's own `.claude/cerebro` copy

**What happened.** This bead's changes live in the `.claude/cerebro` submodule, edited in place inside
my own atlantis-hud worktree (`.cerebro/worktrees/ah-2sy/.claude/cerebro`, on its own branch, exactly
the tree the bead's own new `prepare-worktree` script produces). Running `bash tests/launchers.sh`
there failed one case — `launch Xavier: expected --effort high, got: BEADS_ACTOR=Xavier ...` — with
real absolute paths (`/Users/henrikku/repos/atlantis-hud/.cerebro/worktrees/ah-2sy/...`) showing up
inside output the test expects to come from an isolated fixture. The same suite, same commit, run
from a throwaway standalone clone (`git clone` into `/tmp`, no consumer above it), passed all cases.
**Why.** `scripts/consumer-root` climbs from `${BASH_SOURCE[0]}` to find the enclosing consumer
tree — and inside a real implementer worktree there genuinely is one (the atlantis-hud worktree
itself), so it does not refuse the way cerebro's own CLAUDE.md says testing from "here" should
(`there is no .claude/ above this tree`). Some part of the launcher test's own isolation (likely a
sandboxed models.conf/session env) leaked against the real enclosing tree instead of a fixture,
producing extra output that broke the test's line-oriented parsing. Not narrowed further than that —
diagnosing past "which environment reproduces it" was not this bead's job.
**Cost.** About 15 minutes: one full pass of `tests/*.sh` with an unexplained failure, a check of
`BEADS_ACTOR` in the environment, an `env -u` retry that still failed, and finally a second full
clone to get an authoritative isolated run.
**Prevent by.** cerebro's own CLAUDE.md already tells a reader "build a throwaway consumer repo
rather than running the script here" for testing a change to these scripts — but frames it as "it
will refuse", which is only true from a *standalone* clone. A line naming the case this bead hit —
testing from inside a real implementer worktree's own submodule copy does not refuse, and can fail
for reasons unrelated to your change — would have saved the second clone.
**Seen before.** None found (`ah-rnz.md` covers a different `tests/launchers.sh` failure, a bash
3.2/`declare -A` issue, not this one).
