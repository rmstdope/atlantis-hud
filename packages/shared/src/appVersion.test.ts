import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./appVersion";

const read = (relative: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));

describe("the version the application reports", () => {
  it("falls back to a marker when the build did not define one", () => {
    // Vitest has no Vite `define`, so this is the path the unit tests themselves run on. It exists
    // so that reading the version can never throw: a settings panel that crashes because nobody
    // wired a build constant is a worse failure than one that says "dev".
    expect(APP_VERSION).toBe("dev");
  });
});

describe("the versions the release is cut from", () => {
  /**
   * The root manifest is the single source, and this is what stops the copies drifting from it.
   *
   * Tauri reads its own version out of `tauri.conf.json` and stamps it into the bundle, so a bump
   * that touches only `package.json` ships an application whose About box and whose installer
   * disagree. Catching that here means catching it on the pull request, rather than on the tag,
   * where the release job checks the same thing but has already spent ten minutes compiling.
   */
  it("agree between the root manifest and the Tauri configuration", () => {
    const root = read("../../../package.json");
    const tauri = read("../../../apps/desktop/src-tauri/tauri.conf.json");

    expect(tauri.version).toBe(root.version);
  });
});
