# ah-g9sf.7.2 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-12
- **PR:** #1201

## Stripping conflict markers wholesale deleted the closing brace of the function above

**What happened.** Three of this bead's four rebase conflicts were "both sides appended a test to
the end of the file" — the incoming hunk and main's hunk each a self-contained block, with nothing
to choose between them. I resolved those by deleting the three marker lines with
`[l for l in lines if not l.startswith('<<<<<<< ') and l != '=======' and not l.startswith('>>>>>>> ')]`
and keeping everything. That is wrong whenever the `<<<<<<<` falls *inside* a function body rather
than between two items: the `=======` line then stands where the HEAD side's closing `}` would
otherwise have been read as part of the block, and the merged text runs the tail of one function
straight into the head of the next. It happened twice, in
`crates/core/tests/movement_trace.rs` and `crates/core/tests/movement_graph.rs`, both times
producing `error: this file contains an unclosed delimiter` pointing at the last line of the file —
a message that names a location three hundred lines away from the mistake.

**Why.** Established. A conflict hunk's boundaries are not item boundaries. Git places `<<<<<<<`
at the first differing *line*, which for "both sides appended after the last function" is inside
that last function's body, not after its `}`. Keeping both sides therefore needs the brace put back
by hand; deleting only the marker lines silently merges two items into one.

**Cost.** About ten minutes and two extra local gate runs. No CI cycle — `cargo test` caught both
before anything was pushed.

**Prevent by.** After resolving any conflict by keeping both sides, compile that file alone before
staging it (`cargo test -p <crate> --test <file>` is enough, and is seconds). Better, never strip
markers programmatically: read the hunk and write the resolution, because the question "is this
`=======` between two items or inside one" is the whole of the resolution and a filter cannot ask
it.

**Seen before.** `ah-fvzu` — same shape of trap one level up: a textually trivial conflict resolved
by keeping both sides, compiling, passing the gate, and being wrong. That one was wrong about
meaning; this one about syntax. Both say a resolution that keeps both sides is a change that needs
reading, not a mechanical merge.

## Main moved three times during one bead, and each move conflicted

**What happened.** Between opening PR #1201 and merging it, main gained four commits
(`ah-3u7c.1`, `ah-g9sf.8`, `ah-7ale.2.1`, and one more), three of which touched the very files this
bead touches — `movement/plan.rs`, `movement/trace.rs`, `PlannerPanel.tsx`. Two full rebases were
needed, the second one after the first had already been pushed, and each brought real API changes to
absorb: `cheapest_path` began returning a tuple, `RouteStep` gained a `canal` field, and
`describeStep` gained a `· canal` clause my `waterMark` change had to be woven into rather than
replace.

**Why.** Established, and structural rather than anybody's mistake: several implementers work the
movement subsystem at once, and a bead that spends an hour in review will meet whatever landed
during it.

**Cost.** About twenty-five minutes across two rebases, one extra CI cycle, and one typecheck
failure (`RouteStep.canal` missing from a test fixture) that only appeared after the second rebase.

**Prevent by.** Nothing to change in the process — this is the cost of parallel work on one
subsystem, and the `strict: false` protection that let the first (clean) state merge is what keeps
it from being worse. Worth knowing as a planning fact: a bead in `crates/core/src/movement/` should
expect its post-review rebase to be a real one with API drift in it, and should budget a gate run
for it rather than assuming the pre-review gate still speaks for the tree.
