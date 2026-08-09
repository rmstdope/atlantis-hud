import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// The root manifest is where the version is edited, and the shells are told what it is rather than
// reading it back at runtime. A unit test asserts this and `tauri.conf.json` still agree.
const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Served straight out of the repository rather than copied in by a build step. The shells fetch
  // /ruleset.json at startup, and a copy that only happens when somebody remembers to run a script
  // is a copy that will be missing wherever nobody remembered - which is what broke CI.
  publicDir: fileURLToPath(new URL("../../config/public", import.meta.url)),
  envPrefix: ["VITE_", "ATLANTIS_"],
  plugins: [react(), tailwindcss()]
});
