# ah-bet5 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #457

## Reverting a deliberate breakage with `git checkout` threw away the uncommitted implementation

**What happened.** The plan's *Validation* section asks the implementer to break the parser on
purpose three times and confirm the new check catches each — "Revert." after each. The
implementation was still uncommitted at that point (the gate had not run yet), so
`git checkout packages/ruleset/src/data.ts` reverted the breakage *and* both real edits: the
`SKILL_OPENING` export and the `readCastCost` rewrite. `grep -c "matchAll(CAST_INPUT)"` returned 0,
which is the only reason it was noticed before the gate.

**Why.** Established. "Revert" is ambiguous when the file also holds work that is not yet committed,
and the obvious command for it — `git checkout <file>` — reverts to HEAD, not to the pre-breakage
state.

**Cost.** About five minutes: re-applying two edits from the scrollback and one extra test run.

**Prevent by.** A plan whose validation asks for a deliberate breakage should say to **commit the
implementation first**, and then revert with `git checkout <file>`; or, if the work must stay
uncommitted, to snapshot the file (`cp <file> /tmp/<file>.good`) and restore from that copy. Either
is one line in `implement-bead`'s *Building* section or in the plan's own *Known traps*. The second
and third breakages here were reverted from a `/tmp` copy and cost nothing.

**Seen before.** None found — `docs/retrospectives/ah-aao.md` and `ah-4ao.md` both involve
`git checkout` in a worktree, but the mechanism there is submodule/worktree confusion, not
uncommitted work being discarded.
