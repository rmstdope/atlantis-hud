# ah-8v1io — retrospective

- **Implementer:** Shadowcat
- **Date:** 2026-11-24
- **PR:** #1973

## A cargo-only Dependabot bump of a Tauri crate fails `native` on the npm/crate version check

**What happened.** Dependabot's cargo update of `tauri-plugin-fs` (2.5.1 to 2.7.1) changed only
`Cargo.lock`. That bump also pulled the `tauri` crate from 2.11.5 to 2.12.7. In the `native` job,
`tauri build` stopped with "Found version mismatched Tauri packages", because
`@tauri-apps/plugin-fs` was still 2.5.1 and `@tauri-apps/api` was still 2.11.1. The fix was to bump
both npm packages by hand on the Dependabot branch.

**Why.** Dependabot updates the cargo and npm ecosystems in separate PRs. `tauri build` refuses any
npm package whose major/minor differs from its crate's. So any Dependabot PR that moves one side of
a Tauri pair past a minor version is red by construction.

**Cost.** One red Dependabot PR, a bugfix bead, and a bugfixer pass of about 40 minutes. Dependabot
also rebased the branch while the fix was in progress, so the first push was rejected and the fix
commit had to be re-applied on top of Dependabot's rebase.

**Prevent by.** In `.github/dependabot.yml`, either:
- ignore minor and major updates of `tauri*` crates and `@tauri-apps/*` packages in both
  ecosystems, so a person moves each pair together, or
- group them, so each ecosystem's Tauri updates arrive in one PR at a time and the pairing is still
  done by hand, but once.

Today nothing pairs them, and every Tauri minor bump will repeat this bead.

**Seen before.** none found.
