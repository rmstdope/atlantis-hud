# ah-wwyr — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-26
- **PR:** #740

## The plan's own validation snippet silently "failed" under the implementer's default shell

**What happened.** The bead's Validation section gives a copy-paste snippet that sets
`GENERATED="dir1 dir2"` unquoted and passes it to `git status --porcelain -- $GENERATED`, expecting
bash's default word-splitting to turn it into two pathspecs. Run verbatim in this session's
interactive shell it printed `NOT CAUGHT` and a `git`
`warning: could not open directory 'packages/core-client/src/generated packages/ruleset/src/'` —
which reads exactly like the widened check not working, when the check itself (added to `ci.yml`,
which GitHub Actions runs under bash) was already correct.

**Why.** The Bash tool's shell here is zsh (confirmed with `echo $0`), and zsh does not
word-split an unquoted variable expansion by default the way bash does — `set -- $GENERATED; echo
$#` printed `1`, not `2`. Wrapping the same snippet in `bash -c '...'` reproduced the intended
`caught` result immediately.

**Cost.** About 10 minutes and three extra tool calls (`xxd`, `set --`, checking `$IFS`) to tell a
shell difference apart from an actual defect in the change under test.

**Prevent by.** A plan (or this skill) that hands over a validation snippet relying on unquoted
multi-word variable expansion for pathspec-style word-splitting should either quote it as an array
(`GENERATED=(dir1 dir2)` is also zsh/bash-incompatible, so this doesn't fully solve it either) or
say explicitly to run it via `bash -c '...'` — since an implementer's interactive shell is not
guaranteed to be bash, and the failure mode (a `git` warning plus a wrong-looking answer) looks
exactly like the code under test being broken.

**Seen before.** None found.
