import { createCoreClient } from "@atlantis/core-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createWebCoreAdapter, loadCoreWasm } from "@atlantis/browser-core";

const root = createRoot(document.getElementById("root")!);

// The core is WebAssembly, so it must finish instantiating before anything can call it. Rendering
// after the await keeps every panel free of a "core not ready yet" state.
loadCoreWasm()
  .then((wasm) => {
    const client = createCoreClient(createWebCoreAdapter(wasm));
    root.render(
      <StrictMode>
        <App client={client} />
      </StrictMode>
    );
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    root.render(
      <main>
        <h1>Atlantis HUD Web Shell</h1>
        <p role="alert">failed to load the Atlantis core: {message}</p>
      </main>
    );
  });
