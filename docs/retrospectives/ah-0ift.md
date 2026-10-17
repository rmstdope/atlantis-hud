# ah-0ift — retrospective

## Proving a committed fix red with a stash applied another session's stash

**What happened.** To show a follow-up test failing without the fix, I ran
`git stash push -m <tag> crates/core/src/orders/semantics.rs`. The fix was already committed, so
the path had no changes and nothing was stashed. The next command looked the entry up by its tag,
found nothing, and ran `git stash apply` with an empty sha. That applied `stash@{0}`, another
session's entry from the stash stack all worktrees share, into this tree and conflicted in
`effects.rs` and `transport.rs`. The apply failed, so the `&& git stash drop` after it never ran
and nothing was lost. The test run in between was against the unreverted code, so the "red"
check it was meant to be proved nothing.

**Why.** A stash of a path with no uncommitted change is a silent no-op. A lookup that returns an
empty string turns `git stash apply "$sha"` into `git stash apply`, which means the top of a stack
other sessions write to.

**Cost.** About five minutes: restoring the two files, checking the other session's stash was
intact, and rerunning the red check.

**Prevent by.** For "red without the fix" once the fix is committed, reverse the fix's own patch:
`git diff origin/main...HEAD -- <file> > fix.patch && git apply -R fix.patch`, test, then
`git apply fix.patch`. That touches no shared state. The worktree note the harness prints about
stashes could say so too, and should say an empty sha must abort before `apply`.

**Seen before.** No. `ah-leeg` mentions `git stash` only as a command a prompt failed to forbid.
