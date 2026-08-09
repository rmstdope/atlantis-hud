import type { CoreClient } from "@atlantis/core-client";
import { AppShell } from "@atlantis/shared";
import { beforeQuit } from "./quitGuard";

/**
 * The desktop shell.
 *
 * Everything visible lives in AppShell, shared with the other platform, so the two builds are
 * identical rather than merely similar. All that differs is the core this hands it - WebAssembly
 * here, Tauri IPC on the native desktop - and the one thing only a native window has: a close that
 * can be held open until unsaved orders are on disk.
 */
export default function App({ client }: { client: CoreClient }) {
  return <AppShell client={client} platformLabel="desktop" registerBeforeQuit={beforeQuit} />;
}
