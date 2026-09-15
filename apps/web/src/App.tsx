import type { CoreClient, StorageStopSource } from "@atlantis/core-client";
import { AppShell, browserHttpTransport, browserTextFileSaver } from "@atlantis/shared";
import { useWebAppUpdate } from "./useWebAppUpdate";

/**
 * The web shell.
 *
 * Everything visible lives in AppShell, shared with the other platform, so the two builds are
 * identical rather than merely similar. All that differs is the core this hands it - WebAssembly
 * here, Tauri IPC on the native desktop - the one thing only a served application has: a copy
 * on a server that can be newer than the copy that is running - and the browser's own `fetch` as
 * the way to reach a New Age world.
 */
export default function App({
  client,
  storageStop
}: {
  client: CoreClient;
  storageStop: StorageStopSource;
}) {
  return (
    <AppShell
      client={client}
      storageStop={storageStop}
      platformLabel="web"
      appUpdate={useWebAppUpdate()}
      saveTextFile={browserTextFileSaver}
      // A New Age world allows cross-origin requests from the live web address, so the browser's
      // own fetch reaches it. Offered on every address: a self-hosted copy the world refuses gets
      // the sign-in sentence that names that cause.
      newAgeTransport={browserHttpTransport}
      newAgeFromBrowser
    />
  );
}
