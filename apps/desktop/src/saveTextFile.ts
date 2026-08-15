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
 *
 * Reaches the dialog and the file write through `desktopPlugins.ts` (ah-9lv) rather than importing
 * them directly, so a test can install a stand-in for the one native call an export makes.
 */

import { browserTextFileSaver, type TextFileSaver } from "@atlantis/shared";
import { desktopPlugins, type DesktopPlugins } from "./desktopPlugins";

/**
 * The native dialog's filter for a file name, derived from its extension.
 *
 * The dialog needs to be told what kind of file it is offering to save; leaving it hard-coded to
 * Text (as it was before ah-jfx) fought a `.json` name - either mangling it or appending `.txt`.
 * An extension this does not recognise gets no filter at all rather than a guess.
 */
export function filterFor(fileName: string): { name: string; extensions: string[] }[] | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "json":
      return [{ name: "JSON", extensions: ["json"] }];
    case "txt":
      return [{ name: "Text", extensions: ["txt"] }];
    default:
      return undefined;
  }
}

/**
 * The saver to hand the workspace: a native save dialog over the given plugins, or the browser
 * download when there are none - a plain browser, the preview server, or a web-style smoke run.
 *
 * Required now (ah-150): the fork used to be an optional prop the workspace forwarded as-is, and
 * the same defect - a desktop export landing wherever the webview put it, no dialog, no path - was
 * fixed three times before the fork moved in here, where there is exactly one place left to get it
 * wrong. `plugins` defaults to `desktopPlugins()` so `App.tsx` can call this with no arguments; a
 * test passes a fake (or `undefined`) directly.
 */
export function desktopTextFileSaver(plugins: DesktopPlugins | undefined = desktopPlugins()): TextFileSaver {
  if (!plugins) {
    return browserTextFileSaver;
  }

  return async (fileName: string, text: string) => {
    const path = await plugins.save({
      defaultPath: fileName,
      filters: filterFor(fileName)
    });
    // The player pressed Cancel. Nothing is written, and nothing is claimed to have been.
    if (path === null) {
      return null;
    }

    await plugins.writeTextFile(path, text);
    return path;
  };
}
