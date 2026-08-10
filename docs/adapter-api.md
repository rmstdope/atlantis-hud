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
TypeScript Tauri adapter passes them explicitly rather than translating.

## TypeScript abstraction

- Package: `packages/core-client`
- API:
  - `createWasmAdapter(bindings)`
  - `createTauriAdapter(invoke)`
  - `createCoreClient(adapter)`
- Contract normalization:
  - Accepts adapter wire payloads in either `camelCase` or `snake_case`
  - Returns canonical `EngineInfo` in `camelCase`
