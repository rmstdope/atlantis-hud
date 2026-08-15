# ah-o1t.1 — retrospective

- **Implementer:** Storm
- **Date:** 2026-08-15
- **PR:** #268

## A new Tauri command needs a matching entry in the native binding sweep, and the plan did not name it

**What happened.** CI's `native` job failed on first push with `sweeps exactly the commands the
invoke handler registers`, in `tests/native/binding.spec.ts`. Registering the three new commands
(`list_hex_notes`, `save_hex_note`, `delete_hex_note`) in `apps/desktop/src-tauri/src/main.rs`'s
`generate_handler![...]` — which the plan's *Known traps* section did call out — was not enough:
that same file holds a `SWEEP` table which the test asserts is exactly the registered command set,
in both directions, and nothing in the plan mentioned it. Every earlier layer (SQLite, backup,
`core-tauri`, `core-wasm`, `core-client`, `browser-core`, `shared`) had a local test suite that ran
in `pnpm check`; this one only runs as CI's `native` job on Linux, so the first sign of it was a red
check twenty minutes after the PR opened.
**Why.** The plan's *Known traps* section named `cargo check --workspace` as covering `main.rs`, and
it does cover compilation — but the binding sweep is a separate, hand-maintained list in a test
file the plan's file list never mentions, not something the compiler enforces.
**Cost.** One CI cycle (~7 minutes) plus a rebase, since the branch had gone `BEHIND` while the fix
was pushed and CI re-ran.
**Prevent by.** When a bead adds a new Tauri command, grep `tests/native/binding.spec.ts` for
`generate_handler` at RED time — alongside `main.rs` itself — and add the `SWEEP` entry as part of
the same increment that registers the command, rather than discovering it from a CI failure that a
local `pnpm check` cannot reproduce (the `native` suite needs a Linux runner, as the skill's *Red
CI* section already says, but the specific reason a Tauri-command bead is likely to hit it here
could be spelled out in `implement-bead`'s traps list too).
**Seen before.** None found.
