# ah-v82 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** rmstdope/cerebro#31, rmstdope/cerebro#32, atlantis-hud#296

## A blanket sed sweep silently skipped the one addition mixed into a mechanical file list

**What happened.** The plan's "cerebro — prose (search-and-replace, then read each site)" section
listed about fourteen files to update by mechanical find-and-replace, and buried one exception in
the middle of that list: `CLAUDE.md (×2 — and add one Gotcha: ...)`. I ran a `sed` loop across the
whole list to do the path replacements, verified with `git grep` that no old paths remained, and
moved straight to committing and merging PR #31 — never separately checking for the one *addition*
the same bullet called for, because the git-grep check only proves old strings are gone, not that a
new one was added. It surfaced only when re-reading the design after the merge, and had to ship as
a second, tiny follow-up PR (#32) to the same repo.

**Why.** A search-and-replace pass and "read each site" are two different verifications, and running
only the first (plus a grep for the old string) does not catch a line that was never there to begin
with. The plan's phrasing — one bullet, one file list, an addition parenthesized inside it — reads
easily as "these files all get the same treatment."

**Cost.** One extra PR, one extra Copilot review wait (~2 minutes here, but not guaranteed), one
extra CI cycle (~20s), and one extra worktree/cleanup pass — a few minutes end to end, small only
because cerebro's CI is fast.

**Prevent by.** When a plan's file list mixes pure replacements with an addition or other
non-mechanical edit for one file, treat that file as its own increment step rather than folding it
into the sed sweep — do the addition first, by hand, before running the blanket replace, so it is
not something a `git grep` clean-check can silently miss.

**Seen before.** None found.
