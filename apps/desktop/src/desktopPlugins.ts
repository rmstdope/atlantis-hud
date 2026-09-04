/**
 * The one seam between the desktop shell and Tauri's plugins.
 *
 * ah-9lv: three desktop-only defects (ah-7pa, ah-jfx, ah-6l2) reached the navigator with the
 * `desktop-shell` Playwright project green, because that project has no Tauri runtime and falls
 * back to the same WASM core the `web` project drives - a second web run that asserts nothing the
 * `web` project does not. The dialog and the file write are the one native call a desktop export
 * makes, and there was nothing a browser-driven test could stand in for.
 *
 * The core transport (`desktopCore.ts`'s `hasTauriRuntime`) is untouched by this - IPC vs WASM
 * still decides which core answers a command, and the native suite still covers IPC. This port
 * only carries what the shell calls on plugins today: the save dialog and the file write. With a
 * fake installed here, a `desktop-shell` smoke spec can assert that an export goes through the
 * dialog with the right name and filter, writes what the dialog answered, and that a cancelled
 * dialog writes nothing - the class of defect that slipped through three times.
 *
 * The global is read at call time, not captured at module load: `desktopPlugins()` runs whenever an
 * export fires, well after Playwright's `addInitScript` has installed the stand-in, so there is no
 * ordering to get right. Never set in production - only a test ever writes it.
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
import type { HttpReply, HttpRequest } from "@atlantis/shared";
import { hasTauriRuntime } from "./desktopCore";

/** What the shell asks of Tauri's plugins - the whole of it, so a stand-in is three functions. */
export type DesktopPlugins = {
  save(options: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
  writeTextFile(path: string, text: string): Promise<void>;
  /**
   * One request, answered with the status and the body as text.
   *
   * Only the desktop has this, and for two servers' worth of reason: `atlantis-pbem.com` sends no
   * `Access-Control-Allow-Origin`, so a browser could send the orders form and never read what came
   * back, and `atlantis-newage.com` allowlists CORS origins and does not carry the web deploy. One
   * call rather than one per shape - a GET with a bearer token and two POST bodies go through here.
   *
   * The body it answers with is secret - it can echo the orders document, faction password and all
   * - so nothing here logs it or keeps it.
   */
  httpRequest(request: HttpRequest, signal: AbortSignal): Promise<HttpReply>;
};

declare global {
  interface Window {
    /** A test's stand-in, installed before the bundle loads (Playwright `addInitScript`). */
    __ATLANTIS_DESKTOP_PLUGINS__?: DesktopPlugins;
  }
}

/**
 * The plugins this build can reach: a stand-in when a test installed one, else Tauri's own when the
 * runtime is there, else nothing - which is what the preview server and the web-style smoke run see.
 */
export function desktopPlugins(): DesktopPlugins | undefined {
  if (typeof window !== "undefined" && window.__ATLANTIS_DESKTOP_PLUGINS__) {
    return window.__ATLANTIS_DESKTOP_PLUGINS__;
  }
  if (!hasTauriRuntime()) {
    return undefined;
  }
  return {
    save,
    writeTextFile,
    async httpRequest(request, signal) {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal
      });
      return { status: response.status, body: await response.text() };
    }
  };
}
