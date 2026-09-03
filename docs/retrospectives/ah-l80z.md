# ah-l80z — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-04
- **PR:** #908

## Two new helpers were spliced between a doc block and the function it documented

**What happened.** Both extracted helpers were inserted with a script that anchored on the *signature*
of the function they were to precede — `s.index('fn clamped_holdings(...)')` in `semantics.rs` and
`s.index('#[must_use]\npub fn plan_production(')` in `silver.rs`. A Rust doc block sits *above* the
attributes and signature, so both helpers landed between an existing `///` block and the item it
documented: `clamped_holdings` and the public `plan_production` each lost their documentation to the
private helper beneath them, and the newly rewritten clamp paragraphs — the very text a review round
had asked for — ended up documenting a function that has nothing to do with clamping. Every gate was
green (`pnpm run check:fast`: lint, typecheck, tests, generated, fmt, clippy), because a doc comment
attaches to whatever item follows it and both arrangements compile. The review sub-agent's delta
round caught it.

**Why.** An anchor on a signature is not an anchor on an item. The item begins at the top of its doc
block and its attributes, and a textual insert before the `fn` line therefore lands *inside* the
item, not before it.

**Cost.** One extra delta review round and one CI cycle, about fifteen minutes.

**Prevent by.** When inserting a free function or module textually, anchor on the blank line above
the target's **doc block**, not on its `fn`/`mod` line — or append after the anchor item's closing
brace, which has no such ambiguity. `implement-bead`'s *Traps this fleet has already paid for* is
where this belongs: it is invisible to every gate this project runs.

**Seen before.** `ah-npab` — "A new test module was inserted inside the previous module's doc
comment", the same defect one level up, also green through every gate.
