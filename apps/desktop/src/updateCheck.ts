/**
 * The desktop shell's answer to "is there a newer version".
 *
 * It hands the question to a browser rather than answering it. That is a decision, not a shortcut:
 * this repository is private, so its releases are invisible to an unauthenticated request, and the
 * only ways to compare versions in-process would be to ship a GitHub token inside the application
 * or to publish a version manifest somewhere public. The player's own browser already has the
 * session that makes the page readable, and it is where the download has to end up anyway.
 *
 * This lives in the desktop app rather than in `packages/shared` for the reason `quitGuard.ts`
 * gives: importing `@tauri-apps/api` from shared code would put half a desktop shell in the web
 * bundle.
 */

import type { AppUpdateControl, AppUpdateState } from "@atlantis/shared";
import { UNSUPPORTED_UPDATES } from "@atlantis/shared";
import { useCallback, useState } from "react";
import { hasTauriRuntime } from "./desktopCore";

/**
 * Where releases are published.
 *
 * The capability file scopes `opener:allow-open-url` to this repository, so a URL that drifts from
 * it is refused at runtime rather than opened.
 */
export const RELEASES_URL = "https://github.com/rmstdope/atlantis-hud/releases";

export function useDesktopAppUpdate(): AppUpdateControl {
  const [state, setState] = useState<AppUpdateState>("idle");

  const check = useCallback(() => {
    setState("checking");
    void (async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(RELEASES_URL);
      setState("opened");
    })().catch(() => {
      // The ACL refused it, or there is no browser to hand it to. Either way the honest report is
      // that this build cannot check, rather than a button that appears to have worked.
      setState("unsupported");
    });
  }, []);

  // Opened in a plain browser - `pnpm --filter @atlantis/desktop dev`, and the Playwright desktop
  // project - there is no runtime to open a page with. Saying so beats a button that does nothing.
  if (!hasTauriRuntime()) {
    return UNSUPPORTED_UPDATES;
  }

  return { state, check };
}
