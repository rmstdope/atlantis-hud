# Adapter API: the boundary between the core and the shells

The Rust core is one crate; two shells cross it, and one TypeScript boundary describes both.

- **Desktop**: `#[tauri::command]` — on core-tauri's own `command_*` functions for 24 of the 32
  commands, and on eight thin wrappers in `apps/desktop/src-tauri/src/main.rs` for the games-root
  commands that need the app handle (to resolve where this installation keeps its games).
- **Web**: the 17 `#[wasm_bindgen]` exports of `crates/core-wasm`, plus an IndexedDB store for what
  the core itself holds no opinion about (`packages/browser-core`).
- **TypeScript**: one typed `CoreAdapter` interface (`packages/core-client/src/index.ts`);
  `TAURI_COMMANDS` and `createTauriAdapter` (`packages/core-client/src/tauriCommands.ts`) build the
  desktop transport from a single table; `createWebCoreAdapter`
  (`packages/browser-core/src/webCoreAdapter.ts`) is the web transport; `createCoreClient` adds the
  three ergonomic signatures (`validateOrders`'s options object, `exportMap`/`knownMap`'s JSON
  stringification) that `CoreClient` carries over `CoreAdapter`, and nothing else.

## Core contract (`EngineInfo`)

```json
{
  "id": "atlantis",
  "name": "Atlantis PBEM",
  "rulesetVersion": "4.0",
  "maxFactionCount": 128
}
```

Map topology is intentionally omitted from this payload because it is a fixed game invariant (always hex).

## Movement calls

Both adapters expose the same two movement entry points, each delegating to one shared core
function so the desktop and the browser cannot drift apart. All arguments are strings; the report
travels as raw text, which is the key the core's parse cache remembers it under.

- `plan_route` (Tauri) / `plan_route_state` (WASM) / `CoreClient.planRoute`:
  `(ruleset_json, raw_report, remembered_json, unit_id, destination)` →
  `RoutePlanResponse { plan, problem, risk, fullyModelled }`. A route that cannot be planned
  resolves with a named `problem`; only an unusable ruleset or unreadable memory rejects.
- `trace_move_orders` (Tauri) / `trace_move_orders_state` (WASM) / `CoreClient.traceMoveOrders`:
  `(ruleset_json, raw_report, remembered_json, unit_id, orders)` →
  `MoveOrderTraceResponse { path }`. Traces the last readable MOVE/ADVANCE line in the unit's
  written orders across the remembered map, extrapolating geometrically past everything known and
  guessing unknown terrain from the previous hex. `path` is `null` when there is nothing to draw
  (no movement order, no such unit, or an unknown origin); `path.months` is empty and `path.mode`
  `null` when the unit's speed is unknown (overloaded or unstated); `path.blockedFrom` is the
  index of the first step the game would refuse (a walker entering the sea), or `null`. Rejects
  on the same two grounds as `plan_route`.

The Tauri commands take snake_case argument names verbatim (`rename_all = "snake_case"`); the
TypeScript Tauri adapter (`TAURI_COMMANDS`) passes them explicitly rather than translating. Since
`ah-wxk.1` the commands are core-tauri's `command_*` functions under the `tauri` feature, renamed
to their bare names, except the eight games-root ones the shell wraps.

## Map export

One entry point, shaped like the movement calls and for the same reason: the file a player trades
with an ally has to come out identical whichever shell wrote it.

- `export_map` (Tauri) / `export_map_state` (WASM) / `CoreClient.exportMap`:
  `(raw_report, remembered_json, request_json)` → the file's whole text.
  `request_json` is a serialized `MapExportRequest { level, fromX, fromY, toX, toY, content }`,
  where the corners are inclusive and may be given in either order, and
  `content { structures, units, advancedResources }` says what to write beyond the region economy,
  markets and exits every export carries. `CoreClient.exportMap` takes the request as an object and
  serializes it.

  The output is report-shaped: comment lines naming the rectangle and the content, the report
  header for the player's own faction and turn, then one region block per visited hex in the
  rectangle, written in the syntax `crates/core/src/report/region.rs` parses. A hex last seen in an
  earlier turn is preceded by `; last seen turn N, M turns before this export`. The current report
  wins wherever it and the remembered map describe the same hex.

  Rejects when the request or the remembered regions cannot be read. A rectangle covering nothing
  visited resolves with a header and no regions.

## Adding a command

1. The Rust function: a `#[tauri::command(rename_all = "snake_case", rename = "…")]` method in
   core-tauri (or, if it needs the app handle, a wrapper in `main.rs`), plus a
   `#[wasm_bindgen]` export in `crates/core-wasm` if the web needs it too.
2. The `CoreAdapter` method, in `packages/core-client/src/index.ts`.
3. The `TAURI_COMMANDS` row, in `packages/core-client/src/tauriCommands.ts` — the command name and
   its argument keys, in parameter order.
4. The `createWebCoreAdapter` method (and the `CoreWasmModule` member it calls through), in
   `packages/browser-core/src/webCoreAdapter.ts`, if step 1 added a wasm export.
5. The `SWEEP` row, in `tests/native/sweep.ts`.

What catches a missing step, so a slip is a failure on the machine that made it rather than a
surprise later:

- **Step 2, 3 or 4 missing or of the wrong arity** — `pnpm run typecheck`: `TAURI_COMMANDS` is
  typed as a mapped tuple over `CoreAdapter`, so a missing method, an extra one, or a row of the
  wrong arity is a compile error.
- **A wrong argument key, an unregistered command, a `SWEEP` row naming a key the command does not
  have, or a wasm export the browser type does not name (or vice versa)** — `pnpm test`
  (`scripts/tauriCommands.test.ts`'s live lockstep), on every machine.
- **The wire itself** — CI's `native` job, the one place a real IPC round trip runs.

## Trust

Neither adapter re-validates what the core sends back: the Tauri wire is Rust's own serde output,
and the wasm wire is our own code, so both are typed at compile time instead of re-checked per
call. `invoke<T>` (desktop) and the `coreWasm.ts` cast (web) are the two points where that trust is
declared; `CoreAdapter`'s own types are ts-rs-generated from the Rust core where such types exist
(`ah-164.2`), so the two sides cannot describe the payload differently by accident.
