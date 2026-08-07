# Adapter API: shared core contract

Issue #3 defines one canonical metadata contract served by both platform adapters.

## Core contract (`GameInfo`)

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
- Exported function: `get_game_info() -> Result<JsValue, JsValue>`
- Wire shape returned to JS (camelCase):
  - `id`
  - `name`
  - `rulesetVersion`
  - `maxFactionCount`

## Tauri adapter surface

- Rust crate: `crates/core-tauri`
- Exported command: `get_game_info`
- Response shape (camelCase):
  - `id`
  - `name`
  - `rulesetVersion`
  - `maxFactionCount`

## TypeScript abstraction

- Package: `packages/core-client`
- API:
  - `createWasmAdapter(bindings)`
  - `createTauriAdapter(invoke)`
  - `createCoreClient(adapter)`
- Contract normalization:
  - Accepts adapter wire payloads in either `camelCase` or `snake_case`
  - Returns canonical `GameInfo` in `camelCase`
