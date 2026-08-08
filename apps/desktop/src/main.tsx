import { createCoreClient } from "@atlantis/core-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createDesktopCoreAdapter } from "./desktopCore";

const root = createRoot(document.getElementById("root")!);

// Resolving the adapter is async: under Tauri it imports the IPC module, and in a plain browser it
// instantiates the WebAssembly core. Render after it settles so no panel sees a half-ready core.
createDesktopCoreAdapter()
  .then((adapter) => {
    root.render(
      <StrictMode>
        <App client={createCoreClient(adapter)} />
      </StrictMode>
    );
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    root.render(
      <main>
        <h1>Atlantis HUD Desktop Shell</h1>
        <p role="alert">failed to load the Atlantis core: {message}</p>
      </main>
    );
  });
