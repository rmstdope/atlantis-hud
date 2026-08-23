# ah-1wcw.3 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-23
- **PR:** #568

## `check:generated` stays red until the regenerated bindings are committed

**What happened.** The plan says to regenerate the TypeScript bindings with
`ATLANTIS_UPDATE_GENERATED=1 cargo test -p atlantis-hud-core` and commit them. I regenerated, then
ran `pnpm run check:fast` to see the whole gate before committing. It reported
`generated FAIL` with "generated TypeScript bindings differ from the Rust types (cargo test rewrote
them) … commit the rewritten files", while the working tree already held exactly the right content.

**Why.** `scripts/checkGenerated.ts` compares the generated files against git rather than against a
fresh regeneration, so a correct-but-uncommitted binding is indistinguishable from a stale one. The
leg cannot pass until `git commit` has run, which inverts the usual gate-then-commit order for any
bead that changes a `#[ts(export)]` type.

**Cost.** One extra full `check:fast` run, about three minutes, plus the time spent reading the
failure as though the regeneration had not worked.

**Prevent by.** `implement-bead`'s *Building* section, or any plan whose *Files to change* names a
binding regeneration, saying explicitly: commit the regenerated files **before** running the fast
gate, because the generated leg reads git and not the working tree. A one-line note in
`scripts/checkGenerated.ts`'s own failure message ("commit them, then re-run the gate") would say it
where it is actually read.

**Seen before.** none found.
