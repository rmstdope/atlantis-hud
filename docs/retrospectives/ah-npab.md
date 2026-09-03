# ah-npab — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-03
- **PR:** #903

## A new test module was inserted inside the previous module's doc comment

**What happened.** The plan asked for `mod give_before_market` to go "immediately after
`mod shared_market`", which in `crates/core/src/orders/semantics.rs` means immediately *before*
`mod shared_region_products`. I inserted it with a scripted `str.replace` anchored on the first
line of that module's doc comment — `/// month, and every own unit producing there shares it: …` —
which is the line the plan quoted as the boundary. That line is the *second* line of the comment,
so the new module landed between two `///` lines: `give_before_market` was documented by a stray
`ah-256d` fragment about region `Products`, and `shared_region_products` opened mid-sentence.
`cargo test -p atlantis-hud-core` (2048 passed) and the whole of `pnpm run check:fast` — lint,
typecheck, fmt, clippy — were green with the comment split, because a doc comment attaches to
whatever item follows it and both were still items.

**Why.** A `mod`'s boundary is the top of its doc comment, not the line above `mod`. A plan naming
a module as an insertion point, and an implementer anchoring on a comment line, both quietly mean
"somewhere in this comment".

**Cost.** One review round and one CI cycle, about fifteen minutes. The review sub-agent caught it;
no local gate could have.

**Prevent by.** When inserting an item next to another in Rust, anchor on the `mod`/`fn`/`struct`
keyword line and walk *up* past every leading `///` line before splicing — or, after any scripted
insertion, `sed -n` the twenty lines around it and read them. This skill's *Building* section is
where a check like that would belong; nothing in the toolchain will report it.

**Seen before.** None found.
