/**
 * Saving a file where the player asks, which only the desktop shell can do.
 *
 * A browser download hands the file to the browser and tells the page nothing: not the folder, not
 * whether it was renamed, not whether it happened at all. For an export whose whole purpose is to
 * be found again and sent to somebody else, that is the one thing worth knowing, so the desktop
 * asks with a native save dialog and answers with the path it wrote.
 *
 * Lives here rather than in `packages/shared` for the reason `updateCheck.ts` gives: importing
 * `@tauri-apps/api` from shared code would put half a desktop shell in the web bundle.
 */

import type { TextFileSaver } from "@atlantis/shared";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { hasTauriRuntime } from "./desktopCore";

/**
 * The saver to hand the workspace, or nothing when this build is running in a plain browser.
 *
 * The desktop bundle is also served as a web page during development and by the preview server the
 * smoke tests run against, so the runtime check is what keeps it from offering a native dialog
 * that is not there.
 */
export function desktopTextFileSaver(): TextFileSaver | undefined {
  if (!hasTauriRuntime()) {
    return undefined;
  }

  return async (fileName: string, text: string) => {
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: "Text", extensions: ["txt"] }]
    });
    // The player pressed Cancel. Nothing is written, and nothing is claimed to have been.
    if (path === null) {
      return null;
    }

    await writeTextFile(path, text);
    return path;
  };
}
