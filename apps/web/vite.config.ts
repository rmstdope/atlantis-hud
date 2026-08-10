import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// The root manifest is where the version is edited, and the shells are told what it is rather than
// reading it back at runtime. A unit test asserts this and `tauri.conf.json` still agree.
const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

// The dark ground the workspace is drawn on, from `packages/shared/src/theme.css`. Repeated rather
// than imported because this value is read by the operating system - it paints the splash screen
// and the title bar of an installed window before any stylesheet has loaded.
const GROUND = "#10151c";

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Served straight out of the repository rather than copied in by a build step. The shells fetch
  // /ruleset.json at startup, and a copy that only happens when somebody remembers to run a script
  // is a copy that will be missing wherever nobody remembered - which is what broke CI.
  publicDir: fileURLToPath(new URL("../../config/public", import.meta.url)),
  envPrefix: ["VITE_", "ATLANTIS_"],
  plugins: [
    react(),
    tailwindcss(),
    // Web only. The desktop shell is a Tauri webview with no service worker and its own update
    // story, and giving it a second cache in front of a bundle it already ships locally would only
    // add a way for the two to disagree.
    VitePWA({
      // The smoke suite runs against a production build for speed, but a service worker caching
      // pages between tests would make that build a different application than the one the suite
      // was written for. The flag keeps it out; `tests/pwa` exercises the real build, worker and
      // all. The virtual `pwa-register` modules still resolve when disabled - they become no-ops.
      disable: process.env.ATLANTIS_PWA_DISABLE === "1",
      // The application holds unsaved order drafts. Swapping the running code underneath somebody
      // mid-sentence is not worth the few seconds it saves, so a new deployment waits and says so.
      registerType: "prompt",
      // Off: the dev server serves no service worker either way, and turning one on there would
      // put a cache in front of every local iteration loop for nothing.
      devOptions: { enabled: false },
      includeAssets: ["favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "Atlantis HUD",
        short_name: "Atlantis HUD",
        description: "A heads-up display for the play-by-email game Atlantis.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: GROUND,
        theme_color: GROUND,
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          // Padded, so Android's circular crop takes the padding rather than the artwork.
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        // `wasm` and `json` are the two that matter and neither is precached by default: the core
        // is WebAssembly and refuses to start without it, and the ruleset is what keeps unit
        // man-counts exact rather than estimated. Without them the installed app opens offline and
        // is useless, which is worse than not opening at all.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,json}"],
        // Headroom rather than a fix. The chunk carrying the map renderer and the orders editor is
        // around 290 KiB against Workbox's 2 MiB default - it was roughly 750 KiB until #58 took
        // the map off PixiJS - and nothing today is close, but the
        // failure when something does cross it is that the file is silently dropped from the
        // precache, and an installed application quietly stops working offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // One page, no router: everything resolves to the same document.
        navigateFallback: "index.html"
      }
    })
  ]
});
