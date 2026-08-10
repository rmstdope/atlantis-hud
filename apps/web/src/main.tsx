import "@atlantis/shared/src/theme.css";

import { createCoreClient } from "@atlantis/core-client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createWebCoreAdapter, loadCoreWasm, requestPersistentStorage } from "@atlantis/browser-core";

const root = createRoot(document.getElementById("root")!);

// Asked once, at startup, and not waited for. Games live in IndexedDB, which the browser may
// discard under storage pressure until an origin asks it not to; the answer changes nothing about
// how the application runs, so there is no reason to hold the first render behind it.
void requestPersistentStorage().then((outcome) => {
  const message = {
    persisted: "Storage is persistent: this browser will keep your games until you remove them.",
    denied: "This browser declined persistent storage, so it may discard games if it needs space.",
    unsupported: "This browser cannot be asked for persistent storage."
  }[outcome];
  // Warned rather than logged when the data is evictable, because that is the case worth noticing
  // in a report from somebody who lost a game.
  (outcome === "persisted" ? console.info : console.warn)(`[atlantis-hud] ${message}`);
});

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
