import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/**
 * The value `.cerebro/project.conf` declares for a key, read as `project-conf` reads it: a `#` and
 * everything after it is a comment, and leading whitespace before the key is allowed.
 */
function declared(key: string): string | undefined {
  for (const raw of read(".cerebro/project.conf").split("\n")) {
    const [k, ...rest] = raw.replace(/#.*/, "").trim().split(/\s+/);
    if (k === key) return rest.join(" ");
  }
  return undefined;
}

/** The port tauri dev loads the desktop window from. */
function tauriDevPort(): string {
  const conf = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as { build: { devUrl: string } };
  return new URL(conf.build.devUrl).port;
}

/** The port the desktop package's `dev` script (tauri's beforeDevCommand) starts vite on. */
function viteDevPort(): string | undefined {
  const pkg = JSON.parse(read("apps/desktop/package.json")) as { scripts: Record<string, string> };
  return /--port\s+(\d+)/.exec(pkg.scripts.dev)?.[1];
}

describe("the declared desktop launch port (ah-oc9y8)", () => {
  it("is the port tauri dev serves the desktop shell on, so the verifier checks the right one", () => {
    expect(viteDevPort()).toBe(tauriDevPort());
    expect(declared("launch_desktop_port")).toBe(tauriDevPort());
  });
});
