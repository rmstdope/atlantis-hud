import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..");

function read(path: string): string {
  return readFileSync(join(REPO, path), "utf8");
}

/** The value `.cerebro/project.conf` declares for a key: the rest of its one uncommented line. */
function declared(key: string): string | undefined {
  const line = read(".cerebro/project.conf")
    .split("\n")
    .find((l) => l.startsWith(`${key} `) || l.startsWith(`${key}\t`));
  return line?.slice(key.length).trim();
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
