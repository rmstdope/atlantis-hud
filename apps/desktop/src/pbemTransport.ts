/**
 * Reaching atlantis-pbem.com, which only the desktop shell can do: the site sends no
 * `Access-Control-Allow-Origin`, so a browser could post the download form and never read the
 * reply.
 *
 * Lives here rather than in `packages/shared` for the reason `saveTextFile.ts` gives: importing
 * `@tauri-apps/*` from shared code would put half a desktop shell in the web bundle. Its absence
 * on web is the whole of what hides the Fetch button there, the rule `desktopNewAgeTransport` and
 * `desktopOrdersUploader` already follow.
 *
 * Nothing here logs a request or a reply. Both carry a faction password in cleartext.
 */

import type { HttpTransport } from "@atlantis/shared";
import { desktopPlugins, type DesktopPlugins } from "./desktopPlugins";

/**
 * The transport to hand the New Origins download, over the given plugins.
 *
 * With no plugins - a plain browser, the preview server, a web-style smoke run - the returned
 * transport rejects rather than pretending to have fetched anything.
 */
export function desktopPbemTransport(
  plugins: DesktopPlugins | undefined = desktopPlugins()
): HttpTransport {
  return async (request, signal) => {
    if (!plugins) {
      throw new Error("This build cannot reach New Origins: there is no desktop runtime.");
    }
    return plugins.httpRequest(request, signal);
  };
}
