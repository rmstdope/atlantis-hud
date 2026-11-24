# ah-6fcsh — retrospective

- **Implementer:** Nightcrawler
- **Date:** 2026-11-24
- **PR:** #1988

## The same cargo-only Tauri plugin bump failed `native` again, the same day

**What happened.** Dependabot's cargo update of `tauri-plugin-dialog` (2.7.2 to 2.8.4) changed only
`Cargo.lock`. `tauri build` in the `native` job stopped with "Found version mismatched Tauri
packages", because `@tauri-apps/plugin-dialog` in `apps/desktop/package.json` was still 2.7.2. The
fix was to bump the npm package to ^2.8.4 on the Dependabot branch.

**Why.** The cause ah-8v1io recorded: Dependabot updates cargo and npm in separate PRs, and the Tauri
CLI refuses a crate/npm pair whose major/minor differ. `.github/dependabot.yml` still neither groups
nor ignores the Tauri pairs.

**Cost.** One more red Dependabot PR, bugfix bead and bugfixer pass (about 20 minutes, most of it
the CI wait). Every remaining Tauri plugin pair (`tauri-plugin-*` / `@tauri-apps/plugin-*`) and
`tauri` / `@tauri-apps/api` will repeat this on its next minor release.

**Prevent by.** The `.github/dependabot.yml` change ah-8v1io proposes: ignore minor and major
updates of `tauri*` crates and `@tauri-apps/*` packages in both ecosystems, so a person moves each
pair together, or group them per ecosystem. Until then, a bugfixer can expect a red `native` on
every Tauri minor bump, and the fix is always to bump the npm twin.

**Seen before.** ah-8v1io (`tauri-plugin-fs`, PR #1973), the same day.
