/**
 * Holding the window open long enough to save.
 *
 * On the web, closing a tab fires `pagehide` and the shared shell writes what it has; the browser
 * leaves when it leaves, and the autosave ceiling bounds what a half-finished write can cost. A
 * native window close is not a page event, and Tauri does not promise the webview gets one. So the
 * close is intercepted here: the handler runs to completion, then the window is destroyed.
 *
 * This lives in the desktop app rather than in `packages/shared` because that package is what makes
 * the two builds identical rather than merely similar. Importing `@tauri-apps/api` from shared code
 * would put half a desktop shell in the web bundle.
 */

import type { RegisterBeforeQuit } from "@atlantis/shared";
import { hasTauriRuntime } from "./desktopCore";

/**
 * Registers `handler` to run before the window closes, when there is a window to close.
 *
 * Opened in a plain browser - `pnpm --filter @atlantis/desktop dev`, and the Playwright desktop
 * project - there is no Tauri runtime, and the shared shell's `pagehide` handler is the whole
 * story. Returning a no-op there keeps that path from paying for an import it cannot use.
 *
 * The listener is registered asynchronously because the API arrives by dynamic import, so the
 * returned function may be called before it exists. `cancelled` is what makes that safe: a shell
 * unmounted mid-import must not leave a listener behind holding a stale handler.
 */
export function registerBeforeQuit(handler: () => Promise<void>): () => void {
  if (!hasTauriRuntime()) {
    return () => undefined;
  }

  let cancelled = false;
  let unlisten: (() => void) | null = null;

  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    const stop = await appWindow.onCloseRequested(async (event) => {
      // Refuse the close, save, then close for real. Without preventDefault the window is already
      // going and the write races it - which is the whole reason this file exists.
      event.preventDefault();
      try {
        await handler();
      } finally {
        await appWindow.destroy();
      }
    });

    if (cancelled) {
      stop();
      return;
    }
    unlisten = stop;
  })();

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** The type the shared shell expects, asserted here so a drift in either shows up at build time. */
export const beforeQuit: RegisterBeforeQuit = registerBeforeQuit;
