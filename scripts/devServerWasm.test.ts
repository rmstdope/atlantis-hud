/**
 * A long-lived dev server must not serve a WebAssembly core older than the Rust sources beside it
 * (ah-rbuc). The wiring is the regression surface, so these tests read the configs and manifests as
 * text; nothing here starts Vite or builds the core.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const APPS = ["web", "desktop"];

describe("the dev servers' wasm freshness wiring", () => {
  it("both dev servers load the wasm freshness plugin", () => {
    for (const app of APPS) {
      const config = readFileSync(join(REPO, "apps", app, "vite.config.ts"), "utf8");
      expect(config, `apps/${app}/vite.config.ts`).toContain("wasmFreshness(");
      expect(config, `apps/${app}/vite.config.ts`).toContain('from "../../scripts/wasmFreshness"');
    }
  });

  it("both dev scripts refresh the core through ensure-wasm rather than build:wasm", () => {
    for (const app of APPS) {
      const manifest = JSON.parse(readFileSync(join(REPO, "apps", app, "package.json"), "utf8"));
      const dev: string = manifest.scripts.dev;
      expect(dev, `apps/${app} dev`).toContain("scripts/ensure-wasm.mjs");
      expect(dev, `apps/${app} dev`).not.toContain("build:wasm");
      expect(dev.indexOf("ensure-wasm.mjs"), `apps/${app} dev`).toBeLessThan(dev.indexOf("vite"));
    }
  });
});
