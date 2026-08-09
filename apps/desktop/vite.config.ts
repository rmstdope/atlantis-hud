import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Served straight out of the repository rather than copied in by a build step. The shells fetch
  // /ruleset.json at startup, and a copy that only happens when somebody remembers to run a script
  // is a copy that will be missing wherever nobody remembered - which is what broke CI.
  publicDir: fileURLToPath(new URL("../../config/public", import.meta.url)),
  envPrefix: ["VITE_", "ATLANTIS_"],
  plugins: [react(), tailwindcss()]
});
