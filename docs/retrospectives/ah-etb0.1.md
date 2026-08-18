# ah-etb0.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-19
- **PR:** #431

## `check:fast` compiles none of the desktop shell's plugin wiring or its capabilities file

**What happened.** The bead added a Tauri plugin: a `dep:` entry in the `desktop-runtime` feature
list, a `.plugin(tauri_plugin_http::init())` registration in `apps/desktop/src-tauri/src/main.rs`,
and a scoped `http:default` grant in `capabilities/default.json`. `pnpm run check:fast` passed with
every one of those three lines unverified — its `cargo clippy --workspace --all-targets` builds
`atlantis-hud-desktop-shell` with `default = []`, so the whole `desktop-runtime` cfg block, and the
`tauri-build` capability validation that goes with it, is compiled out. A misspelled permission
identifier or an unregistered plugin passes the documented local gate untouched.

**Why.** Established. `apps/desktop/src-tauri/Cargo.toml` sets `default = []` and gates every plugin
behind `desktop-runtime`; a workspace-wide build with default features therefore never enters that
code. CI covers it in a job of its own (`ci.yml:439,442`, `cargo check`/`cargo clippy -p
atlantis-hud-desktop-shell --features desktop-runtime`), which is why it does not reach main.

**Cost.** None here, because the bead's plan named a separate build step as validation and following
it up exposed the gap. Had the plan not said so, the first sign would have been a CI job — or, for
the class of defect that only the ACL rejects at runtime, the navigator.

**Prevent by.** Two concrete things. The plan's validation command,
`pnpm --filter @atlantis/desktop run tauri build --debug`, **does not exist** — there is no `tauri`
script in `apps/desktop/package.json` (its scripts are `dev`, `build`, `preview`, `lint`,
`typecheck`, `test`, `logs:export`, `build:wasm`), and it exits 0 with "None of the selected packages
has a tauri script", which reads as a pass. `plan-bead` should check a validation command exists
before writing it into a plan. And `implement-bead`'s *Building* section should say what the gate
does **not** cover: a bead touching `apps/desktop/src-tauri/` wants
`cargo check -p atlantis-hud-desktop-shell --features desktop-runtime` (and the matching clippy) run
by hand, which is what CI runs and what validates the capabilities file.

**Seen before.** ah-wxk.1-verifier — the same `default = []` gating, from the other side: launching
the dev build without `--features desktop-runtime` silently ran the stub `main`.
