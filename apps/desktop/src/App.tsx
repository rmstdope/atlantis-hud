import type { CoreClient } from "@atlantis/core-client";
import { AppShell } from "@atlantis/shared";
import { beforeQuit } from "./quitGuard";
import { desktopTextFileSaver } from "./saveTextFile";
import { useDesktopAppUpdate } from "./updateCheck";

/**
 * The desktop shell.
 *
 * Everything visible lives in AppShell, shared with the other platform, so the two builds are
 * identical rather than merely similar. All that differs is the core this hands it - WebAssembly
 * here, Tauri IPC on the native desktop - and the one thing only a native window has: a close that
 * can be held open until unsaved orders are on disk.
 */
export default function App({ client }: { client: CoreClient }) {
  return (
    <AppShell
      client={client}
      platformLabel="desktop"
      registerBeforeQuit={beforeQuit}
      // Undefined when this bundle is opened in a plain browser, which is what the preview server
      // and the smoke suite do: there is no native dialog there, and the download is the answer.
      saveTextFile={desktopTextFileSaver()}
      appUpdate={useDesktopAppUpdate()}
    />
  );
}
