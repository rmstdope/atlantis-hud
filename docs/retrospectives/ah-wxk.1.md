# ah-wxk.1 — retrospective

- **Implementer:** Cyclops
- **Date:** 2026-08-16
- **PR:** #329

## `#[tauri::command]` on a `pub fn` at a library crate's root does not compile

**What happened.** The plan's core mechanism — put `#[cfg_attr(feature = "tauri",
tauri::command(...))]` directly on the existing `pub fn command_*` functions at the top level of
`crates/core-tauri/src/lib.rs` — failed `cargo check -p atlantis-hud-core-tauri --features tauri`
on the very first command with:

```
error[E0255]: the name `__cmd__command_parse_report` is defined multiple times
error[E0255]: the name `__tauri_command_name_command_parse_report` is defined multiple times
```

pointing at the same span twice, as if the attribute had expanded itself twice. It had not:
a minimal two-crate reproduction (`#[tauri::command] pub fn cmd_a() { 1 }` alone in a fresh
library crate's `lib.rs`) reproduced the identical error with nothing else in the file.

**Why.** `tauri-macros-2.6.3/src/command/wrapper.rs:162-167` adds `#[macro_export]` to the
attribute's generated helper macros whenever the annotated function's visibility is `pub`
(`Visibility::Public` or `Visibility::Restricted`). `#[macro_export]` always places the generated
macro at the *crate root*, regardless of which module the function lives in. When the function
itself already lives at the crate root — which every `pub fn command_*` in `lib.rs` did — the
macro's textual definition and its `#[macro_export]`-injected root definition collide: same name,
same scope, defined "twice". The plan's own verification against the macro source (cited in its
Context section) confirmed `rename`, path-based `generate_handler!` resolution, and
sync-with-borrowed-args all work as claimed — it just never exercised a crate-root-level `pub fn`,
which is the one placement this repository's functions actually used.

**Cost.** About 45 minutes: one failed build, sizing up the error, a throwaway `/tmp` crate to
isolate the cause from the real (large, DTO-heavy) file, and a second `/tmp` two-crate repro to
confirm the fix (moving the function into a submodule with a `pub use` re-export at the crate root)
before touching `crates/core-tauri/src/lib.rs` for real. No CI cycles lost — caught locally before
the first push.

**Prevent by.** When a plan puts `#[tauri::command]` (or any attribute macro that conditionally
`#[macro_export]`s based on visibility) directly on an existing `pub fn`, check where in the module
tree that function already lives before assuming the attribute alone is enough — a `pub fn` sitting
at a library crate's *root* module needs to move into a submodule (with a `pub use` re-export to
keep its external path) before the attribute can be added, and that submodule move belongs in the
plan's file list rather than being discovered mid-build. A cheap check: `grep -c "^pub fn " crates/
<crate>/src/lib.rs` — if the count is non-trivial and none of them already live in a submodule, the
plan should call out the move explicitly rather than presenting the attribute as a one-line change.

**Seen before.** none found.
