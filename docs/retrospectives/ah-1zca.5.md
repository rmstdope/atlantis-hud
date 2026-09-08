# ah-1zca.5 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-09
- **PR:** #1081

## An unchecked scripted `str.replace` reported a review finding fixed when it was not — again

**What happened.** Answering the cold read's finding 2 (a doc sentence in
`crates/core/src/orders/transfers.rs` claiming `selected` calls its `held` closure "at most three
times"), I applied two edits in one `python3 - <<'PY'` heredoc: an `assert old in s` guarded the
first, and the second — the doc sentence — was a bare `s.replace(old, new, 1)` with no guard. The
`old` did not match byte for byte, so it was a silent no-op. The commit message, the PR comment and
the prompt to the next review round all said finding 2 was taken. The delta round opened the file and
found the sentence untouched at line 84.

**Why.** Established. `str.replace` returns the string unchanged rather than raising, and a heredoc
of several replaces shares one exit code that says nothing about any individual one. The guard was
present on the replace immediately above it in the same script and omitted on this one — so the
failure mode is not ignorance of the rule but applying it unevenly within a single call.

**Cost.** One extra review round and one extra CI cycle, about twelve minutes — and, for one round, a
false claim in the PR record that the reviewer had to disprove.

**Prevent by.** This is the third sighting of the same family and the second of the identical
defect, so the prevention `ah-ndp9` proposed — a rule in `implement-bead`'s *Answering it, and going
on* requiring every scripted edit that answers a finding to be verified in the tool call that makes
it — is still unwritten and would have caught this exactly. The narrower, mechanical form that would
also have caught it: never mix guarded and unguarded replaces in one heredoc; if any `replace` in a
script carries `assert old in s`, all of them must. Changing the skill is the navigator's, so this
records rather than fixes.

**Seen before.** `ah-ndp9` — *An unchecked scripted `str.replace` reported a review finding fixed
when it was not*, the same defect, same phase, same consequence. `ah-npab` — a scripted `str.replace`
anchored on the wrong line of a doc comment. `ah-8l9a` — index/anchor-based scripted editing failing
silently where `Edit` would have errored. Fourth sighting of the family.
