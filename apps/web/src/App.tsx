import type { CoreClient } from "@atlantis/core-client";
import { AppShell } from "@atlantis/shared";
import { useWebAppUpdate } from "./useWebAppUpdate";

/**
 * The web shell.
 *
 * Everything visible lives in AppShell, shared with the other platform, so the two builds are
 * identical rather than merely similar. All that differs is the core this hands it - WebAssembly
 * here, Tauri IPC on the native desktop - and the one thing only a served application has: a copy
 * on a server that can be newer than the copy that is running.
 */
export default function App({ client }: { client: CoreClient }) {
  return <AppShell client={client} platformLabel="web" appUpdate={useWebAppUpdate()} />;
}
