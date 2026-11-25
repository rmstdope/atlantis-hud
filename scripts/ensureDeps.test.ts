/**
 * `scripts/ensure-deps.mjs` runs before the desktop app's dev and build (ah-20awr), so a checkout
 * whose node_modules predates the lockfile installs before it starts. Pinned here against
 * temporary roots; nothing here spawns pnpm.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installedPackagesAreCurrent } from "./ensure-deps.mjs";

let root: string;

function writeInstalledCopy(contents: string): void {
  mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".pnpm", "lock.yaml"), contents);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ensure-deps-"));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\nplugin-http: 2.9.0\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("installedPackagesAreCurrent", () => {
  it("is true when the last install wrote the lockfile as it stands", () => {
    writeInstalledCopy("lockfileVersion: '9.0'\nplugin-http: 2.9.0\n");
    expect(installedPackagesAreCurrent(root)).toBe(true);
  });

  it("is false when the lockfile has moved since the last install", () => {
    writeInstalledCopy("lockfileVersion: '9.0'\nplugin-http: 2.5.9\n");
    expect(installedPackagesAreCurrent(root)).toBe(false);
  });

  it("is false when nothing has been installed", () => {
    expect(installedPackagesAreCurrent(root)).toBe(false);
  });
});
