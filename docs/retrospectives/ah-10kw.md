# ah-10kw — retrospective

- **Implementer:** Shadowcat
- **Date:** 2026-10-08
- **PR:** #1429

## Main was red on clippy when the branch was rebased onto it

**What happened.** After rebasing onto 39983ed3, `pnpm run check:fast` failed only on clippy:
`needless_borrow` at `crates/core/src/orders/effects.rs:1336`, a line this bead never touched. Main's
own CI run for 39983ed3 was a failure; PR #1432 (ah-0x6x), which introduced the line, had a green
`rust` check on its own head.

**Why.** Not established. #1432 passed on its own head and main does not require a branch to be up
to date (`branches/main/protection` answers 404), so a concurrent merge most likely changed the
type of `report` underneath it.

**Cost.** One extra gate run, and a one-line fix carried on this PR until ah-4oz9 (#1433) landed the same fix on main and the rebase dropped it.

**Prevent by.** Nothing in the merge path re-runs CI on main's result once two PRs land close
together. A check of main's latest CI conclusion at `implement-bead`'s *Merging* step, before the
merge, would name the breakage while its author is still around rather than on the next rebase.

**Seen before.** ah-1wcw.6 (main red after a merge, unnoticed until the next bead's CI).

## A reviewer's claim about main's behaviour turned out wrong, and I filed a bead on it

**What happened.** The round-2 cold review said main also printed "short $200" for a GIVE-overdraft
case. I filed ah-a3l4 on that claim without probing main. A later probe against `origin/main` read
$150, so the bead was closed as not reproducible.

**Why.** I took the claim as checked. The figure came from an intermediate head of this PR.

**Cost.** One invalid bead filed and closed, and one probe run.

**Prevent by.** In `fix-bug`'s handling of review findings, a finding that says "same on main"
is probed against `origin/main` (one temporary test) before any bead is filed on it.

**Seen before.** None found.
