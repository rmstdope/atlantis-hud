# atlantis-hud

A frontend for Atlantis (PBEM) that can be deployed both as a web and as a desktop application.

## Workspace bootstrap

Issue #2 foundation introduces:

- `apps/web` (React + Vite shell)
- `apps/desktop` (desktop shell placeholder)
- `packages/shared` (shared TypeScript primitives)
- `crates/core` (shared Rust core placeholder)

Issue #3 adds:

- `crates/core-wasm` (WASM adapter via `wasm-bindgen`)
- `crates/core-tauri` (desktop command adapter via Tauri)
- `packages/core-client` (shared TypeScript client abstraction for both adapters)

## Commands

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run test:smoke`
- `pnpm run check`
