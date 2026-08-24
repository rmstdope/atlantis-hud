# ah-gdfe — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-24
- **PR:** #656

## `check:generated` stays red until the regenerated bindings are committed — second sighting

**What happened.** Identical to `ah-1wcw.3`, in a bead that had no reason to expect it: this one
adds a *new* generated directory rather than regenerating an existing binding. After the last
increment `pnpm run check:fast` reported `generated FAIL` naming all 23 new files, while the working
tree already held exactly the right content. `git add -A` was not enough either — `git status
--porcelain` reports a staged-but-uncommitted file as `A `, which `staleFiles` counts. Only
`git commit` cleared it.

**Why.** As `ah-1wcw.3` established: `scripts/checkGenerated.ts` compares against git rather than
against a fresh regeneration, so a correct-but-uncommitted binding is indistinguishable from a stale
one. The addition here is that staging does not help, which is not obvious from the failure text.

**Cost.** Two extra `check:fast` runs, about four minutes, and a diagnostic detour through
`git status` to work out why staging had not satisfied it.

**Prevent by.** The prevention `ah-1wcw.3` proposed and which has not been made: a line in
`scripts/checkGenerated.ts`'s own failure message — "commit the rewritten files (staging is not
enough; this reads `git status`), then re-run the gate" — since that is the text an implementer
actually reads at the moment they are stuck. This is now the second bead to pay for it, and the
first one that was not even regenerating an existing type, so the trap is not confined to beads
whose plans could warn about it.

**Seen before.** `ah-1wcw.3` — same leg, same cause, same failure text.

## A plan's `export_to` path was a guess, and the plan said so

**What happened.** The plan sketched
`export_to = "../../../packages/ruleset/src/generated/<Name>.ts"` and explicitly told me to verify
it on one type rather than trust it. The real path is `../../../ruleset/src/generated/<Name>.ts`:
ts-rs resolves `export_to` against `TS_RS_EXPORT_DIR`, which `.cargo/config.toml` already sets to
`packages/core-client/src/generated`, so three levels up lands in `packages/` and not at the
repository root.

**Why.** Established, and recorded above.

**Cost.** None — the plan's first increment existed precisely to find this on one type instead of
twenty-three, and it did, in one `cargo test`.

**Prevent by.** Nothing. This is recorded as the opposite of a complaint: a plan that names its own
uncertainty and buys a cheap increment to settle it converted what could have been a
twenty-three-file rework into a two-minute correction. Worth copying wherever a plan depends on a
path or an attribute nobody has run.
