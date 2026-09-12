# ah-g9sf.8 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-12
- **PR:** #1199

## Resolving a rebase conflict with a regex silently ate a closing brace, twice

**What happened.** Two of this bead's three rebases hit conflicts that were pure unions — two
agents had appended tests to the end of the same file. I resolved both with the same one-liner:

```python
re.sub(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', lambda m: m.group(1)+m.group(2), s, flags=re.S)
```

Both times it produced a file that looked right and did not compile. In
`crates/core/tests/movement_ruleset.rs` it deleted the closing `}` of
`refuses_a_swimming_rule_that_contradicts_the_water_rule`, so the whole test binary failed to build
and **increment 1's two ruleset tests never ran** — the ones that catch the rule being wired
Trident-only. In `crates/core/tests/movement_trace.rs` the same substitution truncated a peer's
`trace_in_shaft` helper mid-body. My own `assert '<<<<' not in out` guard passed in both cases: the
markers were gone, which is exactly what makes this invisible.

**Why.** A conflict hunk's boundaries are not the enclosing block's boundaries. Where a conflict
opens *inside* a function — which is what "both sides appended after the last `}`" produces, because
git anchors the hunk on the last common line — the terminator of the preceding block sits inside one
side's text and a mechanical splice drops or duplicates it. Regex has no notion of matching braces.

**Cost.** About 50 minutes and one blocking review finding. The first breakage shipped to the PR and
was the review's finding 1; the second was caught by `pnpm run check:fast` a minute after I made it.
No CI cycle was burned, because the PR was conflicting and GitHub ran nothing on it either way.

**Prevent by.** `implement-bead` says nothing about resolving a conflict, and the gap is not "be
careful" — it is that the check which catches this already exists and is not named. Two lines worth
adding to *Merging*, beside the local-rebase fallback: **resolve an additive conflict by rebuilding
the file from one side and appending the other's block** (`git show origin/main:<path>` piped to a
file, then the block re-extracted from the pre-rebase sha — which is what finally fixed
`movement_trace.rs` after the regex failed twice), and **compile the file before
`git rebase --continue`**, not after. The absence-of-markers assertion I wrote is worthless and
should be named as such: it proves the substitution ran, never that it was right.

**Seen before.** `ah-ofpb.5` — same failure exactly: scripted conflict resolution dropping a test
function's closing brace, its own *Why* already saying "mechanical text splicing has no notion of
matching braces or trailing commas". `ah-2a96` — adjacent, a scripted edit stranding doc comments
and leaving dead declarations, caught by review rather than by any check. This is the **third**
sighting of one mechanism, and the second where it reached a reviewer.

## The conflicting-PR-gets-no-CI trap recurred the same day it was written up

**What happened.** PR #1199 sat `CONFLICTING DIRTY` with `total_count: 0` workflow runs for about
half an hour while I polled `gh pr checks` for checks that could never arrive. A rebase onto
`origin/main` cleared it and all 11 jobs then ran and passed.

**Why.** Established, and not by me: GitHub schedules no run on a PR it considers conflicting.

**Cost.** Roughly 20 minutes of polling.

**Prevent by.** Nothing new — `docs/retrospectives/ah-g9sf.7.1.md`, written **today**, records this
with a precise fix already drafted: move `implement-bead`'s merge-state check to the *start* of the
first CI wait unconditionally, rather than only after a push that could have raced main, because a
PR can be conflicting at open. This section exists only to say it happened again, to a different
implementer, within hours — which is the evidence that the proposed edit is worth making rather
than noting.

**Seen before.** `ah-g9sf.7.1` (same day), and `ah-64wm` before it.
