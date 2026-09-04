# ah-lyg6.1.1 — retrospective

- **Implementer:** Rogue
- **Date:** 2026-09-04
- **PR:** #922

## A new Tauri command has four registration sites, not the two a plan names

**What happened.** The plan's *Known traps* named two places a Tauri command must be registered
beyond being written: the `pub use commands::{…}` list in `crates/core-tauri/src/lib.rs` and
`tauri::generate_handler![…]` in `apps/desktop/src-tauri/src/main.rs`. There are four. Adding all
the plan named still failed the local gate:

```
scripts/tauriCommands.test.ts > the live Tauri command lockstep
  registeredButNotSwept: [ "export_mage_sheet" ]
```

`tests/native/sweep.ts` needs an entry with the command's real argument names, and
`scripts/tauriCommands.test.ts` carries a hard-coded `expect(renames.size).toBe(32)` that must be
bumped. Neither is discoverable from the trap as written, and the second fails a second time after
the first is fixed, so it costs two gate runs rather than one.

**Why.** The trap was written when the lockstep test did not exist, and describes what breaks *at
runtime on the desktop* rather than what breaks the gate. The lockstep test is the newer and
stricter of the two facts, and it is the one an implementer meets first.

**Cost.** Two full `pnpm run check:fast` runs, about eight minutes.

**Prevent by.** The trap in `.cerebro/traps.md` and in any plan that repeats it should name all
four sites and say that the lockstep count is hard-coded — "a Tauri command is registered in four
places: the `pub use` list, `generate_handler!`, `packages/core-client/src/tauriCommands.ts`, and
`tests/native/sweep.ts`, whose count assertion in `scripts/tauriCommands.test.ts` must be bumped."

**Seen before.** `ah-0w7w` — the same sweep table, one step further on: its finding was an existing
command's `args` drifting out of step with its Rust parameters, and it proposed extending the
lockstep test to compare parameter names against each sweep entry's keys. That change would have
caught this one too, and is still unmade.

## An end-to-end assertion that could not fail on the thing it was written for

**What happened.** The plan's increment 9 specified the smoke spec's assertions: the marker line,
the filename pattern, and that no line begins with `* `. All three hold for a sheet containing no
units at all — which is precisely the failure the plan's own *Validation* section names as the one
a person must check for ("the sheet a silent lie" when the shell sends an empty `mages` list). The
spec was written as specified, passed, and proved nothing. The review round raised it; the stronger
assertion then failed on its first run, with one unit line where five were expected, because the
line filter matched `- ` at column zero and a mage inside a structure is written indented.

**Why.** The assertions were chosen for what is easy to state about a file's shape rather than from
the failure the increment exists to exclude. Nothing in the PR asserted that the shell's list
reached the core: the pure-module test used a stub client and the wasm test supplied unit ids by
hand, so the one test spanning both was the only place that gap could be closed.

**Cost.** One review round and about fifteen minutes — cheap here only because the review caught it.
Merged as first written, it would have been a green suite over a feature that could silently share
nothing.

**Prevent by.** When a plan's *Validation* section names a failure a person must look for, the
increment covering that road should assert the presence of the thing, not only the shape around it —
and the plan is the right place to say so, since increment 9 specified the weak assertions by name.

**Seen before.** None found.
