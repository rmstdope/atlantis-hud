# ah-g9sf.4 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-12
- **PR:** #1185

## I reported a review fix I had not made, because a batching script aborted before writing the file

**What happened.** Answering the cold review's six findings, I applied them as one `python3 - <<'PY'`
heredoc: several `s.replace(...)` calls, each preceded by `assert s.count(old) == 1`, and a single
`open(p, 'w').write(s)` at the end. One assertion in the middle failed — a string I was matching had
been reflowed by `cargo fmt --all` since I last read it — so the script raised `AssertionError` and
**wrote nothing at all**. The edits before the failing assertion existed only in that process's
memory. I then ran the test suite, saw green, and posted an answer to the PR claiming finding 2
("move `struct BuildOrder` above `fn build`'s doc comment") was fixed. It was not: the suite was
green because the change was cosmetic, so nothing could fail. The delta review round caught it,
diffed the two heads, and reported that `semantics.rs:7536-7557` was byte-identical — "the claim,
not the code, was fixed".

**Why.** Established. Two things had to line up. First, a whole-file write at the end of a
multi-edit script makes every edit in that script all-or-nothing, so one stale `assert` silently
discards the rest — and `cargo fmt` between reading a region and matching it is exactly what makes a
match go stale. Second, the failing traceback was printed in the *same* tool result as the test
output I was reading for the next thing, so "AssertionError" scrolled past under a wall of passing
tests. Neither alone would have done it; together they produced a confident false statement to a
reviewer.

**Cost.** One review round — about two minutes of reviewer time plus my own answer — and one extra
commit and CI cycle, perhaps twenty minutes end to end. Cheap this time, and only because a
cosmetic change cannot break a test. The same failure on a behavioural edit would have been a green
suite proving the *old* code still works, which is far worse.

**Prevent by.** Two things, neither of which is "be careful":

- **A verified edit is one you read back.** `implement-bead`'s *The review loop* already says a
  sentence in a PR body about what a helper does must be run or read before it is written. The same
  standard belongs on a sentence about what a *fix* did: before posting an answer to a finding,
  `grep`/`sed -n` the region and see the new text. A green suite is not evidence for a change that
  cannot fail a test.
- **Don't batch unrelated edits behind one write.** One file, one purpose, one write per script —
  or write after each replace — so a stale assertion costs only its own edit and says so loudly.

**Seen before.** `ah-60m` — "A failed glob hid an existing test file, and I overwrote it": the same
shape, where a shell construct failed in a way the agent read as success and acted on. That one cost
nine tests; this one cost a false statement to a reviewer. Two sightings of "a tool failed quietly
and I believed my own intention instead of the output" now.
