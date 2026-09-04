/**
 * Posting a faction's orders to the game server, which only the desktop shell can do.
 *
 * `atlantis-pbem.com` sends no `Access-Control-Allow-Origin` header, so a browser would be allowed
 * to send the multipart form - it is CORS-safelisted - but could never read the reply, and so could
 * not tell the player whether the turn went in. The port is therefore desktop-only, and its absence
 * on web is what hides the control there.
 *
 * Lives here rather than in `packages/shared` for the reason `saveTextFile.ts` gives: importing
 * `@tauri-apps/*` from shared code would put half a desktop shell in the web bundle. It reaches the
 * HTTP plugin through `desktopPlugins.ts` (ah-9lv) so a test can install a stand-in.
 *
 * Nothing here logs or stores a reply. The accepted page echoes the orders document, and its first
 * line carries the faction password in cleartext.
 */

import type { OrdersUploader } from "@atlantis/shared";
import { desktopPlugins, type DesktopPlugins } from "./desktopPlugins";

/**
 * The uploader to hand the workspace, over the given plugins.
 *
 * With no plugins - a plain browser, the preview server, a web-style smoke run - the returned
 * uploader rejects rather than pretending to have sent anything, the same shape
 * `desktopTextFileSaver` uses for the no-runtime case.
 */
export function desktopOrdersUploader(
  plugins: DesktopPlugins | undefined = desktopPlugins()
): OrdersUploader {
  return async (upload, signal) => {
    if (!plugins) {
      throw new Error("This build cannot send orders: there is no desktop runtime to send them through.");
    }
    return plugins.httpRequest(
      {
        method: "POST",
        url: upload.url,
        headers: { "Content-Type": upload.contentType },
        body: upload.body
      },
      signal
    );
  };
}
