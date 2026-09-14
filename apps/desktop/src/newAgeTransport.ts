/**
 * Reaching an Atlantis New Age world's REST API from the desktop shell, through Tauri's http plugin.
 *
 * Lives here rather than in `packages/shared` for the reason `saveTextFile.ts` gives: importing
 * `@tauri-apps/*` from shared code would put half a desktop shell in the web bundle.
 *
 * Nothing here logs a request or a reply. Both can carry a faction password in cleartext.
 */

import type { HttpTransport } from "@atlantis/shared";
import { desktopPlugins, type DesktopPlugins } from "./desktopPlugins";

/**
 * The transport to hand a New Age client, over the given plugins.
 *
 * With no plugins - a plain browser, the preview server, a web-style smoke run - the returned
 * transport rejects rather than pretending to have sent anything.
 */
export function desktopNewAgeTransport(
  plugins: DesktopPlugins | undefined = desktopPlugins()
): HttpTransport {
  return async (request, signal) => {
    if (!plugins) {
      throw new Error("This build cannot reach a New Age world: there is no desktop runtime.");
    }
    return plugins.httpRequest(request, signal);
  };
}
