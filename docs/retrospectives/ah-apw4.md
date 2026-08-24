# ah-apw4 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** rmstdope/cerebro#105 (the code), plus the pointer bump here

## The plan asked for prose that cerebro's own CI forbids

**What happened.** The plan's *Files to change* told me to cite bead ids in
`skills/implement-bead/SKILL.md` and `agents/orchestrator.md` — "(`ah-90gu-cerebro`,
`ah-qled.12-cerebro`; ah-apw4)", "(`ah-y3j1`)" — and I wrote them as instructed. CI's `Bash suites`
job failed on `tests/prose-decoupling.sh`: *"bead ids remain in agent prose - a consumer cannot
resolve these"*. Script comments are exempt; agent and skill prose is not.

**Why.** Established. Cerebro's prose is shipped to consumers that have no access to this fleet's
bead database, so a citation there is unresolvable — the suite enforces it. The plan was written
against the surrounding prose, which cites bead ids freely in `scripts/*` comments, and the
distinction between the two is not visible from the code it points at.

**Cost.** One full CI cycle, about four minutes, plus the rewrite.

**Prevent by.** Cerebro has no declared fast gate of its own — `project-conf gate_fast` answers the
consumer's, which is irrelevant to a submodule-only diff. `for t in tests/*.sh; do bash "$t"; done`
is the whole gate and takes under a minute; it belongs in `implement-bead`'s new *A bead whose diff
is inside `.claude/cerebro`* subsection as the check to run before pushing, in the same place the
route is declared. I have deliberately not added it — changing the skill beyond this bead's plan is
the navigator's call.

**Seen before.** None found (`grep -rl prose-decoupling docs/retrospectives/`).

## `tests/project-facts.sh` fails when run from inside a real consumer worktree

**What happened.** Running the cerebro suite from
`.cerebro/worktrees/ah-apw4/.claude/cerebro` failed `tests/project-facts.sh`
(`FAIL: project_name: got 'Atlantis HUD'`) and `tests/project-sweeps.sh`. Both are green from a
throwaway clone, and CI never saw either.

**Why.** Established, and already known: those tests resolve the enclosing consumer, and inside a
real one they resolve this project rather than their fixture. The plan's *Known traps* names it,
citing an earlier bead.

**Cost.** About two minutes, because the trap was in the plan and I recognised it immediately. It is
recorded only as a **second sighting**: the count is the finding, and the fix — the two tests
isolating themselves from the enclosing checkout — is small and keeps being deferred.

**Seen before.** `docs/retrospectives/ah-2sy.md` — same class, `tests/launchers.sh`, ~15 minutes.
