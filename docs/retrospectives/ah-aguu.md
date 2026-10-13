# ah-aguu — retrospective

- **Implementer:** Storm
- **Date:** 2026-10-13
- **PR:** #1542

## A sibling bead added a fourth copy of the very code this refactoring removed, while it was in flight

**What happened.** ah-aguu exists to stop the stored-turn upgrade being written once per store
(SQL, TypeScript, Rust backup). While it was being built, ah-vtgk (#1540) merged a new repair, the
AtlaClient sighting cap, written exactly that way: in migration 16, in `engineTurns.ts` and
`webStore.ts`, and in `backup.rs`. It also bumped the browser's game database to version 8. The
first `gh pr view` after the review showed `CONFLICTING DIRTY`. The rebase had conflicts in
`backup.rs`, `webStore.ts`, `engineTurns.ts` and its test (deleted on this branch, modified on
main). The refusal smoke test's seed had to move from 8 to 9.

**Why.** Both beads were open at once and touched the same upgrade path. Nothing in the bead graph
linked them: ah-aguu was filed by Forge from the ah-m6pw evidence, and ah-vtgk was planned
separately from the same ah-m6pw fallout.

**Cost.** About 25 minutes: resolving the conflicts by hand, a second wasm build and gate, a
re-run smoke spec, a follow-up review of the merge, and one more CI cycle. The cap is still written
per store, so the drift this bead removes for turn fields remains for the cap.

**Prevent by.** When Forge files a `Refactoring:` bead whose *Where* names files, and when Xavier
plans any bead touching those same files, link the two with `bd dep add` so one waits on the other
(`.claude/agents/architect.md`, filing step; `plan-bead`, the step that looks for related beads).
A grep of open beads' *Where* and plans for the file paths is enough to find them.

**Seen before.** ah-fvzu (a sibling bead merged mid-build into the same code); ah-728m.2.1 (a sibling
shipped this one's seam).
