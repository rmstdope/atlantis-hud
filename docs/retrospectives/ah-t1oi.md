# ah-t1oi — retrospective

- **Implementer:** Storm
- **Date:** 2026-09-08
- **PR:** #1056

## The plan asked for a unit test `crates/core-wasm` cannot run

**What happened.** Increment 5 of the plan named two tests to be written "in both adapters":
`an_atlaclient_map_merges_at_the_turn_each_hex_names` and
`an_atlaclient_map_is_filed_under_the_reserved_source`, in `crates/core-tauri/src/lib.rs` *and*
`crates/core-wasm/src/lib.rs`. The desktop pair wrote fine. The browser pair cannot exist as
written: the only entry point that makes the decision, `prepare_report_merge_state`, is
`#[wasm_bindgen]` and returns `Result<JsValue, JsValue>`, so `cargo test -p atlantis-hud-core-wasm`
cannot call it — a `JsValue` needs a JavaScript runtime that a native test binary has not got. The
crate's own `mod tests` has never held anything but tests of plain core functions, which is the
same fact seen from the other side.

**Why.** The plan reasoned from what the two adapters *do* — both construct the identity, so both
should pin it — rather than from what each adapter's test harness can reach. The desktop adapter's
commands are ordinary Rust functions, so the symmetry looks total until you try it.

**Cost.** About fifteen minutes: writing the pair, discovering the return type, and deciding what to
do instead. Small, because the answer turned out to be an improvement — the identity decision was
lifted into the core as `reserved_merge_identity`, which removed the duplication between the two
adapters and is testable where it now lives. The review then found the remaining gap (the browser
path's provenance row was unasserted end to end) and it was closed in the smoke walk, which is the
only place the web adapter's real answer can be observed at all.

**Prevent by.** A plan naming a test in `crates/core-wasm` should say which *kind* it is. Anything
reached only through a `#[wasm_bindgen]` function is not unit-testable there; it is pinned either in
`crates/core` — by moving the decision, which is usually the better change — or in the smoke suite
against the running web build. `.cerebro/traps.md` already carries the same shape of fact for
`packages/shared` having no jsdom ("a plan that names a `*.test.tsx` there and asks it to observe
something an effect did is asking for a test the harness cannot run"), and this is that trap's Rust
twin.

**Seen before.** None found under this description. `ah-nmts` and `ah-8z4y.3.2` touch
`crates/core-wasm` but about what belongs in the core, not about what can be tested there.
