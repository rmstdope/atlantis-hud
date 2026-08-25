# ah-deo5 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-25
- **PR:** #692

## The disk floor cost the navigator an interruption, because the fix `ah-awcm` found is still not in the tool

**What happened.** `disk-preflight` refused: 5.6 GB free against an 8 GB floor, on a volume 97% full
(178 GB of 228 GB used). Its three "always safe" reclaims total ~250 MB here — nowhere near the
2.4 GB shortfall — and the auto-mode classifier allowed only one of the three
(`~/Library/Caches/Mozilla.sccache`), refusing `~/.cargo/registry/src` twice. The two large trees on
disk belong to the main checkout and to Psylocke's worktree, neither mine to touch. With no reclaim
left that I knew of, I wrote `asking` and put it to the navigator, who chose "proceed anyway". The
build then succeeded.

**Why.** `ah-awcm` (merged as `94fa9db0`, #690, two merges before this bead) established that
`cargo clean -p <crate>` is a large reclaim the classifier *does* allow, and asked for
`disk-preflight`'s output to name it. That change has not been made, so its output still recommends
only the three that do not work — and an implementer reading the tool rather than the retrospectives
does not learn the one that does. I did not know about it and so did not try it.

**Cost.** About four minutes, plus one navigator interruption for a decision that a working reclaim
would have made unnecessary. The interruption is the new part: seventeen retrospectives now record
this refusal, and this is the first to spend the navigator's attention on it.

**Prevent by.** The change `ah-awcm` already specified: `.claude/cerebro/scripts/disk-preflight`'s
"Offline reclaims that are always safe" line should name `cargo clean -p <crate>` first and drop the
two `$HOME` paths the classifier has never allowed. It is the navigator's change, not an
implementer's, which is why a third bead recording it cannot fix it — but it now has a cost in
navigator time attached, not only in implementer minutes.

**Seen before.** `ah-awcm`, `ah-udff`, `ah-y3j1`, `ah-djq`, `ah-3rxk`, `ah-jk9h`, and eleven others.
`ah-awcm` is the one that names the working reclaim.

## The plan specified a function signature that the module boundary forbids

**What happened.** The plan's *design of the code* said to widen `because_clause` to take
`hex: &Hex<'_>`, and that its one caller "already has all three to hand". Neither held. `Hex` is
private to `orders::semantics` (`semantics.rs:1153`, no `pub`), and `silver.rs`'s own module header
states in terms that it has "no dependency on `super::semantics`'s private hex types" — so the
signature as written was not reachable without breaching a stated architectural posture. Separately,
`check_pillage_men` had no `plurals` parameter to hand at all; it had to be threaded in.

**Why.** The plan was written from the *call site* of `counted_item`, whose signature takes `hex`,
without checking `Hex`'s visibility or the header of the module the new code would live in.

**Cost.** About ten minutes of design in the middle of an increment, and a judgement call
(extract `counted_with_singular`, the hex-free half of `counted_item`) that the plan had not made.
Both deviations are mechanical and are written up in the PR body, but they were decisions taken
under a plan that read as settled.

**Prevent by.** Where a plan names an exact signature for an existing function, it should state the
**visibility** of every type in it and, if the function is moving data across a module boundary,
quote that module's header if it constrains what may cross. `plan-bead`'s *Files to change* section
is where that belongs. A grep for `struct <Type>` costs the planner one command and would have
caught both.

**Seen before.** None found.
