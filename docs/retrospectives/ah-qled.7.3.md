# ah-qled.7.3 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-21
- **PR:** #531 (and rmstdope/cerebro#79)

## `mergeStateStatus` read `CONFLICTING`/`DIRTY` on a head that had just rebased cleanly

**What happened.** `git rebase origin/main` succeeded with no conflict, `git push --force-with-lease`
went through, and `git rev-list --count HEAD..origin/main` was 0 — the head was current with main.
`gh pr view 531 --json mergeable,mergeStateStatus` nonetheless answered `MERGEABLE CONFLICTING`
immediately afterwards, and it was still answering that after the skill's documented poll (which
waits only while either field reads `UNKNOWN`, and neither did). About thirty seconds later, with
nothing pushed in between, the same command answered `MERGEABLE BLOCKED`, which was correct — CI had
started and had not finished.
**Why.** GitHub recomputes mergeability asynchronously and evidently serves the *previous* head's
verdict during that window, rather than `UNKNOWN`. Not proven beyond the observation above.
**Cost.** Roughly a minute, and nearly a second unnecessary rebase: `implement-bead`'s *Merging*
section says a `CONFLICTING DIRTY` reading means "do not enter the CI wait, go and rebase", which is
exactly the wrong move for a branch that has just rebased cleanly.
**Prevent by.** `implement-bead`'s *Merging* section, in the merge-state check: before acting on a
`CONFLICTING DIRTY` reading taken within a minute of a push, confirm it locally —
`git fetch origin main && git rev-list --count HEAD..origin/main`, where 0 means the head is not in
fact behind and the verdict is stale. Only rebase when git agrees there is something to rebase onto.
**Seen before.** None found. The nearest is the ah-k6i.5 note already in *Merging*, which is the
opposite case: a genuinely conflicted head reading clean-looking check state.
