# ah-0w7w — retrospective

- **Implementer:** Wolverine
- **Date:** 2026-08-22
- **PR:** #558

## Adding a parameter to an existing Tauri command passes every local check and fails `native` in CI

**What happened.** This bead added a `map_json` parameter to four existing Tauri commands
(`plan_route`, `trace_move_orders`, `preview_orders`, `trade_routes`) and one new one
(`set_game_map`). `pnpm run check:fast` was fully green — lint, typecheck, unit/tooling, generated,
fmt, clippy — including `scripts/tauriCommands.test.ts`'s "live Tauri command lockstep". CI's
`native` job then failed four specs with
`invalid args 'map_json' for command "trace_move_orders": missing required key map_json`.

**Why.** The lockstep test compares the **set of command names** across `main.rs`, the sweep table
and core-client's adapter. It caught the one thing I added — `set_game_map` was registered but not
swept — and I fixed that, which made the test green and read as "the sweep table is now in step".
It is not: the table's `args` for the four *existing* commands still omitted the new key, and
nothing local checks the arguments. Only the real-IPC sweep in `tests/native/binding.spec.ts` does,
and that runs in CI only.

**Cost.** One CI cycle, about 25 minutes wall-clock including the wait for `native` to finish so its
log became readable (`gh run view --log-failed` refuses while the run is in progress, and the other
jobs were still going).

**Prevent by.** When a diff changes the **signature** of an existing Tauri command — not only when
it adds or removes one — update that command's `args` in `tests/native/sweep.ts` in the same edit,
and treat the lockstep test passing as evidence about names only. The lockstep test already parses
`commandParameters(mainRs, coreTauriLibRs)`; extending it to compare those parameters against each
sweep entry's `args` keys would move this whole class of failure from CI to the local gate. That is
a change to a shared test rather than to this bead, so it is recorded here rather than made.

## `grep -E "^error"` over cargo output silently matches nothing

**What happened.** After adding a field to a Rust struct I ran `cargo test --workspace 2>&1 | grep -E
"^error" -A5` and got no output, and read that as "compiles clean". It did not: eight test-only
struct literals were missing the new field. The same command with `--color=never` printed all of
them.

**Why.** Cargo emits ANSI colour codes when its output is a pipe under this harness, so an error
line begins with the escape sequence rather than with `error`, and `^error` cannot match. The
failure mode is silent and reads exactly like success.

**Cost.** A few minutes and one misleading "DONE" — small here only because the very next command
happened to surface the errors.

**Prevent by.** Pass `--color=never` to any `cargo` invocation whose output is being grepped, and
prefer checking the exit status over grepping for a pattern that assumes a bare line start.

**Seen before.** None found for either finding.
