# ah-1zca.1 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-09-08
- **PR:** #1064

## Parsing `gh pr checks` by column reported a false all-green while four jobs were still running

**What happened.** Waiting on CI, I polled with
`gh pr checks 1064 | awk '$2=="pending"' | wc -l` and it answered `0` while four `smoke` jobs were
still `IN_PROGRESS`. This repository's matrix job names contain spaces and commas —
`smoke (web, 1, 2)` — so `gh pr checks`'s tab-separated output puts `pending` in field 4 for those
rows and field 2 for every other job. A second attempt with
`jq '.conclusion // .status'` on `statusCheckRollup` failed the same way for a different reason: a
running job's `conclusion` is the **empty string**, not `null`, so `//` kept the empty string and
the running jobs grouped under an empty key that no `IN_PROGRESS` pattern matched.

Both misreads say "green" while jobs are running, which is the direction that matters: the next
step after the CI wait is the merge.

**Why.** Established for both. A whitespace-delimited parse cannot survive a column value that
contains whitespace, and jq's `//` tests for `null`/`false`, not for emptiness — and the GitHub API
spells an unfinished job's conclusion `""` rather than `null`.

**Cost.** About four minutes and two false readings. No harm done: I checked the rollup by hand
before trusting it, which is the only reason the merge did not go early.

**Prevent by.** Poll a check rollup with a name-independent expression that tests emptiness
explicitly, never by shell column:

```bash
gh pr view <n> --json statusCheckRollup \
  -q '[.statusCheckRollup[] | if (.conclusion // "") == "" then .status else .conclusion end]
      | group_by(.) | map("\(.[0]):\(length)") | join(" ")'
```

`implement-bead`'s *Waiting, without ending your run* gives the `until` shape and leaves the
condition to the implementer; this is the condition worth writing there, for a repository whose job
names carry spaces.

**Seen before.** None found. `docs/retrospectives/ah-4k3.md`, `ah-t2pn.1.md`, `ah-6uo.md` and
`ah-4ue.md` all concern CI checks that were *absent* or 503'd, not checks that were present and
misparsed.
