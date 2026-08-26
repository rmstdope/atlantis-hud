# ah-ofpb.5 — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-26
- **PR:** #719

## A textual "keep both sides" conflict resolution left the file with invalid syntax that only a build caught

**What happened.** This bead and its sibling `ah-ofpb.2` (BUILD) both extend the exact same seam —
`ItemMovement`, `UnitPreview`/`PreviewedUnit`, `formatItems`/`itemsTooltip`, and the same test
fixtures — because the plan explicitly modelled this bead's recording on `produce()`'s and named
`ah-ofpb.2` as the sibling shape. `ah-ofpb.2` merged to main while this PR sat waiting on its
Copilot review, so `git rebase origin/main` produced a genuine conflict (not a stale-read false
`CONFLICTING`) on every struct literal and function both beads touched — about a dozen spots across
`effects.rs`, `unitPreview.ts` and two test files. Resolving most of them was mechanical (keep both
sides' field/line), but in three places doing that left the file with a syntax error rather than
working code: a test function missing its closing brace before the next `#[test]`, two object
literals missing a comma between the two kept fields, and a `for` loop in `itemsTooltip` missing its
closing `}` before the next `if`. `git diff` and a read-through of the resolved hunks did not
surface these — the markers were gone and the text looked plausible line by line — and they were
only caught because `cargo build` / `tsc --noEmit` were run immediately afterward.

**Why.** A conflict block boundary does not always land on a statement boundary. When two commits
each add one line to the tail of a block (a struct field, a `push()` call's trailing field, a
function's closing brace) and both insertions get kept, the block's terminator can end up captured
inside one side's hunk and dropped, or duplicated across both — mechanical text splicing has no
notion of matching braces or trailing commas.

**Cost.** About 15 minutes: two crates worth of Rust conflicts and four TypeScript files, plus one
`cargo build` cycle and one `tsc --noEmit` cycle to find and fix the three syntax breaks. No CI cycle
was spent on it, since it was compiled locally before pushing.

**Prevent by.** After resolving any merge/rebase conflict with a "keep both sides" strategy —
whether by hand or with a scripted pass — always compile/typecheck before trusting the resolution,
even when every `<<<<<<<`/`=======`/`>>>>>>>` marker is gone and a visual diff looks sane. This
already happens naturally as part of the fast gate the skill requires before pushing, so the
practical addition is: don't skip straight to `git push` off of "no markers left" — run the build
first, specifically because a "keep both" splice is the case where a green `grep` for markers is not
evidence of correct syntax.

**Seen before.** None found.
