# ah-z73s.3 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-08-26
- **PR:** #725

## A clean git auto-merge left code that did not compile, with no conflict marker on it

**What happened.** The PR came back `CONFLICTING`/`DIRTY` against `origin/main` after two sibling
beads (`ah-dxfd.2` #721, `ah-ofpb.2` #718 by way of `ah-ofpb.5` #719) landed on `semantics.rs` while
this one was in review. `ah-dxfd.2` renamed `apply_gifts_of_men` to `apply_transfers` and
restructured it into a new `hex_with_transfers` helper. Resolving the real, marked conflicts (eight
hunks, mostly two independent new fields on the same structs) left one line untouched by either
side's diff: `review_turn`'s `hexes` map went from

```rust
let mut hex = Hex::read(region, &ordered, &formed);
apply_transfers(&mut hex.units, ruleset);
let ledger = ledger_for(&hex, ruleset, &receipts);
apply_recruits(&mut hex.units, &ledger, ruleset);
```

to

```rust
let hex = hex_with_transfers(region, &ordered, &formed, ruleset);
let ledger = ledger_for(&hex, ruleset, &receipts);
apply_recruits(&mut hex.units, &ledger, ruleset);
```

with no `mut` on `hex` — `hex_with_transfers` is main's replacement for the first two lines, which
git's line-based merge took cleanly because neither side's diff touched that exact line; my own
unmodified `apply_recruits(&mut hex.units, ...)` line two below it was carried through unchanged.
The result compiles as far as the borrow checker, which is where it stopped:
`cannot borrow hex.units as mutable, as hex is not declared as mutable`. Caught by `cargo build`
immediately after resolving, before any test ran.
**Why.** Established, and this is the third sighting of the same mechanism: git's merge is
line-based, so a line neither side's diff marks as changed is carried through even when a change
just above or below it changes what that line depends on. `ah-oq3` named this first (a tuple arity
left mismatched with no marker); `ah-11lh` recorded a near miss of it in the same file.
**Cost.** About five minutes - caught by the build that always follows a resolve here, before any
push.
**Prevent by.** Nothing new to add to the skill: *Merging*'s 422 path already resolves locally and
the fast-gate build that follows a resolve is what caught this, exactly as it caught `ah-oq3`'s and
almost caught `ah-11lh`'s. Recording this as a third sighting, now in the same file both those beads
also hit it in (`semantics.rs`) - three sightings in one file's merge history over ten days may be
worth `ah-oq3`'s "structural fix" more than the first two did.
**Seen before.** `ah-oq3`, `ah-11lh`.
