# ah-oq3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-17
- **PR:** #361

## A rebase's git-level auto-merge left a tuple-arity mismatch that no conflict marker flagged

**What happened.** After review, `git rebase origin/main` hit real conflicts (both this bead and a
concurrently-merged one, `unit-overloaded`, added a variant to `codes::ALL` and to the same
`every_advisory_code_can_be_silenced` test's `cases` list in `semantics.rs`). Those were flagged and
resolved by hand as usual. But a *third* spot in the same test - `unit-overloaded`'s own case tuple,
several lines below the textual conflict hunks - merged cleanly with no marker at all, because git's
line-based merge saw no overlapping lines. This bead's other, unconflicted commit had changed the
tuple type that entry belongs to from a 3-tuple to a 4-tuple (to carry an optional `Faction Status:`
allowance). The result was a file with no conflict markers left, but one tuple literal now had the
wrong arity - a compile error, not something `git rebase --continue` or a visual diff scan would
catch. It only surfaced because `cargo build`/`cargo test` was run after resolving, before pushing.
**Why.** Two PRs each extended the same shared, list-shaped test fixture in independent but
type-coupled ways (a new enum variant here, a new tuple field there); git's merge is line-based and
has no way to see that a change outside the conflict hunk still depends on the tuple's shape.
**Cost.** About ten minutes: noticed only because a full local build followed the resolve, which is
not itself required by the *Merging* section (CI is the re-gate). Had the resolve been pushed
straight through without a local build, it would have cost a full CI cycle instead.
**Prevent by.** No process change proposed - this is inherent to line-based merges of typed list
literals, not a gap in the skill. Recorded so a second sighting shows whether it is common enough
around `codes::ALL`-shaped fixtures to be worth a structural fix (e.g. giving each case its own named
function instead of a shared tuple type) rather than tolerating it case by case.
**Seen before.** None found.
