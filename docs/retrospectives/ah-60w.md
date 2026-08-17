# ah-60w — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-17
- **PR:** rmstdope/cerebro#55, and the pointer bump in this repository

## A retry loop around `gh` broke on the first attempt because the output was piped

**What happened.** `gh pr create` returned `HTTP 503: No server is currently available` from
`api.github.com/graphql` for about ninety seconds — four attempts, thirty seconds apart, before it
succeeded. The first retry loop I wrote was
`if gh pr create ... 2>&1 | tail -2; then break; fi`, which exited after attempt 1 with no PR
created: in a pipeline the exit status is `tail`'s, not `gh`'s, so a failed `gh` reads as success.
The fix was to capture into a variable (`out=$(gh pr create ...)`) and match the PR URL in it.

**Why.** Established: shell pipeline exit status is the last command's. The `| tail -2` idiom this
skill uses everywhere to keep output short is harmless for a bare command and silently wrong inside
an `if`.

**Cost.** About four minutes and one wasted retry cycle; no CI cycles, nothing pushed twice.

**Prevent by.** In `implement-bead`, wherever a `gh` call is wrapped in a retry or a conditional,
capture the output and test it (`out=$(cmd 2>&1); case "$out" in ...`) rather than piping it. The
`| tail -N` shortening is fine only when the command's status is not being read. Worth one line in
the skill's *Waiting, without ending your run* section, next to the existing `until` loop, since
that is the other place a command's status drives a loop.

**Seen before.** None found — `grep -rl "503\|exit status\|tail -2" docs/retrospectives/` was empty.

## GitHub's API was down long enough to matter, and it is not an implementer's fault

**What happened.** The same 503 window; three of four `gh pr create` attempts failed. Nothing about
the branch, the body or the repository was wrong.

**Why.** A GitHub incident, not established beyond the error text.

**Cost.** Included in the above.

**Prevent by.** Nothing to prevent — recorded only so the next implementer that sees a bare 503 from
`gh` retries for a few minutes rather than diagnosing its own command. Three attempts thirty seconds
apart was enough here.

**Seen before.** None found.
