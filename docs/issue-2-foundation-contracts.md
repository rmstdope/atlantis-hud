# Issue #2 Foundation Contracts

## Workspace layout

- `apps/web`: web shell placeholder (Vite + React + TypeScript)
- `apps/desktop`: desktop shell placeholder (Vite + React + TypeScript)
- `apps/desktop/src-tauri`: desktop Rust shell crate placeholder
- `packages/shared`: shared TypeScript primitives
- `crates/core`: shared Rust core crate placeholder

## Required local/CI commands

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run test:smoke`
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets -- -D warnings`

## Feature flag baseline

- Source: local JSON in each app under `config/feature-flags.json`
- Override: environment variables using `ATLANTIS_FLAG_*`
- Current implemented flag: `enableStructuredLoggingDemo`

## Logging baseline

- Shared logger: in-memory ring buffer in `@atlantis/shared`
- Serialization: JSONL formatting helper in `@atlantis/shared`
- Export UX:
  - Web: download button from app UI
  - Desktop shell: export button from app UI
  - Desktop CLI: `pnpm --filter @atlantis/desktop run logs:export`
