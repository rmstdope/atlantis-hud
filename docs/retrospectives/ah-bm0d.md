# ah-bm0d — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-04
- **PR:** #929

## Grepping for a phrase missed half the comments, because the phrase wraps

**What happened.** The plan's *Known traps* said to find the eight comments of increment 5 by their
text rather than by line: "each contains the phrase 'sharing an id' or 'carrying one id'". I ran
`grep -n "sharing an id\|carrying one id" crates/core/src/orders/semantics.rs`, found the eight, and
rewrote them. The grep was a false negative. `semantics.rs` is `rustfmt`-wrapped at 100 columns, and
in several doc comments the phrase spans a line break — `sharing an` at the end of one line, `id`
at the start of the next — so a single-line pattern cannot match it. The cold review found a ninth
comment (`check_refused_recruits`), and the third round found seven more, two of them wrapped
exactly that way. Increment 5's stated done-condition — "no comment in `semantics.rs` still
describes duplicate unit ids as something the ledger has to live with" — was unmet twice, and both
times a reviewer rather than the implementer caught it.

**Why.** Established. `grep` is line-oriented and the comments are machine-wrapped; the plan's
phrases were quoted from the source as displayed, not as stored.

**Cost.** Two extra commits and one extra CI cycle, roughly 20 minutes. No wrong code shipped: every
miss was prose.

**Prevent by.** When a plan names a phrase to grep for in Rust doc comments, search on the shortest
word-pair that cannot wrap, or search unwrapped. Either of these finds all sixteen where the plan's
own pattern found eight:

```bash
grep -rn "same id\|one id" crates/core/src/          # short enough not to wrap
tr '\n' ' ' < file | grep -o ".\{60\}sharing an id.\{60\}"   # or defeat the wrapping
```

Worth `plan-bead` knowing too: a *concept* to grep for ("duplicate unit ids") is more robust in a
plan than a quoted phrase, since the implementer can then choose a pattern that survives wrapping.

**Seen before.** None found — `grep -rl "grep" docs/retrospectives/` turns up nothing on this.
