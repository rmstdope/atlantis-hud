# ah-4ue — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #399

## The GitHub API returned 503 on most calls for the whole run

**What happened.** `gh pr create`, `gh pr edit --add-reviewer`, `gh pr view --json` and `gh pr checks`
each returned `HTTP 503: No server is currently available to service your request` from
`api.github.com/graphql`, intermittently but frequently, across roughly half an hour. Every one
succeeded on a retry a few seconds later.
**Why.** A GitHub-side incident; nothing in the repository or the branch. Not established beyond that.
**Cost.** About ten minutes of retries. One retry loop written as
`gh pr create ... 2>&1 | tail -2 && break` broke out on the *first* attempt even though `gh` had
failed — `&&` tested `tail`'s exit code, not `gh`'s — which silently turned a twelve-attempt loop into
one attempt.
**Prevent by.** When wrapping a `gh` call in a retry loop, capture its output into a variable and test
`$?` from the `gh` invocation itself (`out=$(gh ...); rc=$?; ... [ $rc -eq 0 ] && break`). Never pipe
into `tail` and test the pipeline. The same applies to the polling loops in `implement-bead`'s
*Waiting, without ending your run*: a `gh` call that 503s returns empty, and a loop that reads empty
as "no reviews yet" or "no checks pending" will either spin forever or break out early — guard on
`[ -n "$out" ]` before interpreting the result. The CI-wait loop here read `pending=0` from four
consecutive empty (503) responses and would have declared CI green had the emptiness check not been
added.
**Seen before.** none found.

## The test helper's fake caret derives the word from the prefix, so the plan's second test case did not work as written

**What happened.** The plan named a closing parenthesis as the natural second boundary and implied the
existing `caret()` stub would serve. It does not: `caret()` decides "typing a word" from
`/[\s"]$/.test(linePrefix)`, so for `BUILD (1,2)` it answers `word: "(1,2)"`, `matchesArgument` filters
everything out and the source returns `null` — a failure that looks like the fix being wrong rather
than the fixture being wrong.
**Why.** The stub models only the two boundaries the core's `word_at_caret` had been asked about
(whitespace and a closing quote); a parenthesis is a third.
**Cost.** One extra RED cycle, about five minutes.
**Prevent by.** A plan that names a boundary the shared `caret()` stub does not model should say so and
give the inline `CaretLookup` literal for it, rather than leaving the implementer to discover it from a
null result. This test now uses an inline lookup returning `word: ""` at the caret.
**Seen before.** none found.
