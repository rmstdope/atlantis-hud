# Adapter API: shared core contract

Issue #3 defines one canonical metadata contract served by both platform adapters.

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

## WASM adapter surface

- Rust crate: `crates/core-wasm`
- Exported function: `get_engine_info() -> Result<JsValue, JsValue>`
- Wire shape returned to JS (camelCase):
  - `id`
  - `name`
  - `rulesetVersion`
  - `maxFactionCount`

## Tauri adapter surface

- Rust crate: `crates/core-tauri`
- Exported command: `get_engine_info`
- Response shape (camelCase):
  - `id`
  - `name`
  - `rulesetVersion`
  - `maxFactionCount`

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
TypeScript Tauri adapter passes them explicitly rather than translating. Since `ah-wxk.1` the
commands are core-tauri's `command_*` functions under the `tauri` feature, renamed to their bare
names, except the eight games-root ones the shell wraps.

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

## TypeScript abstraction

- Package: `packages/core-client`
- API:
  - `createTauriAdapter(invoke)` — the desktop transport, speaking to `core-tauri`
  - `createCoreClient(adapter)`
- The browser transport is `createWebCoreAdapter` in `@atlantis/browser-core`: it implements this
  same `CoreAdapter` contract, over IndexedDB, and is passed to `createCoreClient` exactly like the
  tauri adapter (see `apps/web/src/main.tsx`). It has its own tests in `browser-core`, so this
  package's own tests pin only the tauri adapter's contract.
- `CoreAdapter` is the one typed declaration of the boundary — every method returns `Promise<T>` of
  the real type the core serializes, and nothing re-validates it at runtime: the Tauri wire is
  Rust's own serde output, and the web adapter is our own code. `createCoreClient` adds three
  ergonomic conversions over it (`validateOrders`'s options object, `exportMap`/`knownMap`'s JSON
  stringification) and nothing else (ah-wxk.2).
