# ah-l09a.4 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-09-10
- **PR:** #1157

## Inserting a function above a `fn` line reparented the doc comment below it

**What happened.** The plan said to add `money_read_of` "beside `unit_facts`" in
`crates/core/src/orders/semantics.rs`. I inserted it with a scripted
`s.replace("fn unit_facts<'a>(", <new function> + "fn unit_facts<'a>(")`, anchoring on the
signature line. `unit_facts` carries a nine-line `///` block above that signature — the
"**This is the one place a unit's facts are built**" paragraph — so the insertion landed *between*
that block and the function it documents. Both functions compiled, `cargo fmt`, `clippy` and the
whole gate passed, and rustdoc would have rendered `unit_facts`' architectural warning on a
four-line private helper while `unit_facts` itself went undocumented. The review round caught it as
its first finding.

**Why.** A Rust doc comment binds to the *next item*, and a `fn` signature is not the start of its
item. Nothing in the toolchain says otherwise: an orphaned `///` block above another function is
valid Rust, formats clean and lints clean, so every gate leg passes. The anchor that is safe is the
first line of the doc block; the signature line is the one anchor that is always wrong when the item
is documented — which, in this file, is nearly all of them.

**Cost.** One review finding and one extra commit, about ten minutes. It would have cost much more
if it had merged: the paragraph exists precisely to stop the next agent building `UnitFacts`
somewhere else, and it would have been sitting on the wrong item, invisible.

**Prevent by.** When inserting a Rust item by script, anchor on the **first line of the target's
doc comment** (or on the blank line above it), never on its `fn`/`struct`/`enum` line. After any
scripted insertion into a documented region, print the twenty lines around the insertion and read
the order — no gate leg here checks that a `///` block sits above the item it describes.
`implement-bead`'s *When the plan is wrong* already says to read a helper before building on it;
this is the same care owed to the *shape* of the file being edited, not only to its content.

**Seen before.** None found — `grep -rl "doc comment\|rustdoc\|orphan" docs/retrospectives/` turns
up only unrelated senses of "orphan" (a process, a report line, an Emacs buffer).
