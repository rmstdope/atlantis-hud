# ah-omn7 — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-04
- **PR:** #913

## An inherited `TS_RS_EXPORT_DIR` regenerated the bindings into the shared main checkout

**What happened.** `cargo test -p atlantis-hud-core --lib export_bindings_`, run from
`.cerebro/worktrees/ah-omn7`, reported 89 passing tests and left
`packages/core-client/src/generated/UnitSilver.ts` in the worktree untouched — still without the
new `wantedForOrders` field. Deleting the file and re-running did not recreate it. The bindings had
been written to `/Users/henrikku/repos/atlantis-hud/packages/core-client/src/generated/` — the
**shared main checkout**, which `git -C <repo> status --short` then showed dirty with a modified
`UnitSilver.ts`. The session's environment carried
`TS_RS_EXPORT_DIR=/Users/henrikku/repos/atlantis-hud/packages/core-client/src/generated` as an
absolute path.

**Why.** Established, and it is deliberate on both sides. `.cargo/config.toml` sets
`TS_RS_EXPORT_DIR` under `[env]` **without** `force = true` — the file's own comment says why:
`scripts/checkGenerated.ts` relies on being able to override it, and adding `force` would make that
gate compare the working tree against itself. Cargo's `[env]` without `force` therefore yields to
whatever the caller already exports. An implementer session launched with that variable already in
its environment inherits a path anchored to the main checkout, and every worktree it then works in
exports there instead of to itself.

**Cost.** About fifteen minutes: four `cargo test` runs and a `find` across the repository
establishing that nothing was being written, before checking `env`. The shared checkout was left
dirty in the meantime and had to be restored with `git checkout --`; no commit was made from it.

**Prevent by.** `.claude/cerebro/scripts/prepare-worktree` — or the launcher — unsetting
`TS_RS_EXPORT_DIR` (and `TS_RS_LARGE_INT`) so a worktree's own `.cargo/config.toml` is what answers.
Until then, an implementer whose bead touches a `#[ts(export)]` type should run the export leg as
`env -u TS_RS_EXPORT_DIR cargo test -p atlantis-hud-core --lib export_bindings_`, which is what
finally produced the file here. Note that the local `check:generated` leg is **green either way**:
it regenerates into a temporary directory with its own `TS_RS_EXPORT_DIR`, so it never sees the
stale committed binding. CI's `rust` job on a clean checkout is the only thing that would have
caught it, one push later.

**Seen before.** `ah-gdfe` — the same variable, the other way round: a plan that mis-resolved
`export_to` against it. Nothing about an inherited absolute value.
