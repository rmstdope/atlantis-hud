# ah-ndp9 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-03
- **PR:** #906

## An unchecked scripted `str.replace` reported a review finding fixed when it was not

**What happened.** Four of the five first-round review findings were answered in one
`python3 - <<'PY'` heredoc that applied `s.replace(old, new, 1)` four times with no assertion on any
of them. One `old` did not match the file byte for byte, so that replacement was a silent no-op —
`replace` returns the string unchanged rather than raising. The commit, the PR comment and the
prompt to the next review round all claimed finding 3 was fixed. The delta round opened the file and
found the substring assertion still there, word for word.

**Why.** `str.replace` has no equivalent of the `Edit` tool's uniqueness-and-existence check, and a
batch of them shares one exit code that says nothing about any individual one. The `assert old in s`
guard used elsewhere in the same session was omitted here.

**Cost.** One extra review round and one extra CI cycle, about fifteen minutes — and, worse for a
moment, a false claim in the record that a reviewer had to disprove.

**Prevent by.** In `implement-bead`'s *Answering it, and going on*, requiring every scripted edit
that answers a finding to be verified in the same tool call it is made — an `assert old in s` before
each `replace`, or a `grep` afterwards for the text that should now be gone. The rule already there
about not writing a PR-body sentence before running or reading the thing applies to a reply to a
finding just as much, and this is the mechanical form of it.

**Seen before.** `ah-8l9a` — *Undoing scripted instrumentation threw away two green increments*, the
same root: index/anchor-based scripted editing failing silently where `Edit` would have errored.
That one lost work; this one produced a false claim. Third sighting of the family.
