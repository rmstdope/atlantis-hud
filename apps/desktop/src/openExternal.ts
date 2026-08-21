/**
 * The desktop shell's answer to "open this address".
 *
 * Inside the Tauri webview a link cannot simply be followed: navigating would replace the
 * application's own window with a web page, so the URL is handed to the operating system instead.
 * The import is dynamic for the reason `updateCheck.ts` gives - the plugin does not exist when this
 * bundle is opened in a plain browser, which is what `pnpm --filter @atlantis/desktop dev` and the
 * Playwright desktop project both do. There the web fallback is the right answer, and it is also
 * what a refusing ACL falls back to rather than a click that silently does nothing.
 */

import type { OpenExternal } from "@atlantis/shared";
import { OPEN_EXTERNAL_IN_NEW_TAB } from "@atlantis/shared";
import { hasTauriRuntime } from "./desktopCore";

export const openExternalOnDesktop: OpenExternal = (url) => {
  if (!hasTauriRuntime()) {
    OPEN_EXTERNAL_IN_NEW_TAB(url);
    return;
  }

  void (async () => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  })().catch(() => {
    OPEN_EXTERNAL_IN_NEW_TAB(url);
  });
};
