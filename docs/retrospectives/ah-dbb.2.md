# ah-dbb.2 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** #343

## A local test fix ran green but was never committed, so CI failed on the old code

**What happened.** PR #343 was a real merge conflict against `origin/main` (three Rust files: two
spells were landing in the same match arms and test files as an unrelated `ah-1uj` change). After
resolving the conflicts I ran `cargo test -p atlantis-hud-core --test validate_real_orders`
locally, hit one failing assertion (a hard-coded finding order that turned out wrong once both
changes' findings were both present), fixed the assertion, and reran the test - it passed. I then
ran the rest of the local gate (`cargo test --workspace`, `clippy`, `fmt`, `pnpm run check:fast`),
all green, and pushed. CI's `rust` job failed on the exact assertion I had already fixed locally -
the edit was made to the working tree but never `git add`ed or committed before the push, so the
push carried the merge commit only, not the fix on top of it.

**Why.** After a merge-conflict resolution and a local test failure, I fixed the file and reran
that one test directly rather than re-running `git status`/`git diff` before the next `git push`.
Nothing in the sequence forced a look at the working tree between "test passes" and "push".

**Cost.** One CI cycle, about four minutes wall-clock, plus the wait-and-diagnose time around it.

**Prevent by.** After resolving a merge/rebase conflict and fixing anything the resulting test run
turns up, run `git status --short` immediately before the push that is meant to carry the fix - not
just before opening the PR. A merge conflict is exactly the moment a fix is most likely to be made
mid-flow, uncommitted, since the natural per-file edits during conflict resolution create a habit of
"edit, verify, move on" that a later standalone fix silently inherits without the "add and commit"
step conflict resolution's `git add <file>` would otherwise have forced.

**Seen before.** None found.
