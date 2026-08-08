/**
 * Resolves the core the desktop shell should talk to.
 *
 * Under the Tauri runtime that is the native Rust core over IPC, with SQLite persistence. Opened
 * in a plain browser — `pnpm --filter @atlantis/desktop dev`, and the Playwright desktop project —
 * there is no IPC, so it falls back to exactly what the web app uses: the same Rust core compiled
 * to WebAssembly, with browser storage.
 *
 * The point is that there is no second implementation. Both paths run the same Rust; only the
 * transport and the storage differ.
 */

import { createWebCoreAdapter, loadCoreWasm } from "@atlantis/browser-core";
import type { CoreAdapter, TauriInvoke } from "@atlantis/core-client";
import { createTauriAdapter } from "@atlantis/core-client";

function hasTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

export async function createDesktopCoreAdapter(): Promise<CoreAdapter> {
  if (hasTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return createTauriAdapter(invoke as TauriInvoke);
  }

  return createWebCoreAdapter(await loadCoreWasm());
}
