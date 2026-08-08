import type { CoreClient } from "@atlantis/core-client";
import { AppShell } from "@atlantis/shared";

/**
 * The desktop shell.
 *
 * Everything visible lives in AppShell, shared with the other platform, so the two builds are
 * identical rather than merely similar. All that differs is the core this hands it: WebAssembly
 * here, Tauri IPC on the native desktop.
 */
export default function App({ client }: { client: CoreClient }) {
  return <AppShell client={client} platformLabel="desktop" />;
}
