# ah-0n2k.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-10
- **PR:** #1162

## A CI wait loop read `gh pr checks` as green while four jobs were still pending

**What happened.** The wait loop summarised check state with
`gh pr checks 1162 | awk '{print $2}' | sort | uniq -c`, and broke out of the loop when no line
contained `pending`. It printed `2 (desktop-shell, 2 (web, 7 pass` and reported `DONE` — but
`gh pr checks` had wrapped or space-split the job names `smoke (desktop-shell, 1, 2)` and
`smoke (web, 1, 2)`, so `$2` for those four rows was a fragment of the *name* rather than the
status column. Four smoke jobs were still pending, and the loop said the run was over. The next
command — `gh pr checks 1162 | grep -viE "^\S+\s+pass"` — caught it, and the real wait took another
six minutes.

**Why.** `gh pr checks` output is tab-separated but its first column contains spaces, so any
whitespace-splitting filter (`awk '{print $2}'`, `cut -d' '`) reads the wrong field for exactly the
jobs whose names are parameterised — which on this repository is the four smoke shards, the slowest
and last-finishing jobs there are. A filter that is wrong only about the last jobs to finish fails
precisely when it is about to be believed.

**Cost.** About a minute of my own, and no harm done because the follow-up check was a different
filter. The cost recorded here is the one it did not incur: a merge on a false green.

**Prevent by.** Match on the tab-delimited status field, never on a whitespace-split column —
`gh pr checks <n> | grep -cP '\tpending\t'` for the wait, and
`gh pr checks <n> | grep -viP '\tpass\t'` to confirm before merging. `implement-bead`'s
*Waiting, without ending your run* gives the loop shape but not the condition, and the condition is
where this went wrong; a worked `gh pr checks` predicate there would have prevented it.

**Seen before.** None found. `docs/retrospectives/` has five files mentioning `gh pr checks`
(`ah-4k3`, `ah-wwyr`, `ah-64wm`, `ah-t2pn.1`, `ah-1zca.1`), but all are about the command failing or
reporting no checks at all, not about a false green from parsing its output.
