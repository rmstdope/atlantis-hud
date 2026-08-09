import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RELEASES_URL } from "./updateCheck";

/**
 * A guard over the Tauri ACL, which nothing else here checks.
 *
 * `docs/issue-34-persistence-contracts.md` records the problem: `build.rs` only runs `tauri_build`
 * under the Tauri CLI, so neither `cargo check` nor CI ever reads the capability file. A permission
 * that was never granted fails at runtime, in a release build, on somebody's machine.
 *
 * This does not prove the ACL is correct - only the Tauri CLI can do that, and it does, on the tag.
 * What it catches is the failure that actually happens: adding a plugin and forgetting its
 * permission, or moving the URL the update check opens and leaving the scope behind.
 */

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

type Capability = {
  permissions: (string | { identifier: string; allow?: { url?: string }[] })[];
};

describe("the desktop capability file", () => {
  const capability = JSON.parse(read("../src-tauri/capabilities/default.json")) as Capability;

  it("grants the permission the update check calls", () => {
    const opener = capability.permissions.find(
      (permission) =>
        typeof permission !== "string" && permission.identifier === "opener:allow-open-url"
    );

    expect(opener).toBeDefined();
  });

  it("scopes that permission to the address the update check opens", () => {
    const scopes = capability.permissions
      .filter((permission) => typeof permission !== "string")
      .flatMap((permission) => permission.allow ?? [])
      .map((entry) => entry.url ?? "");

    // A wildcard suffix is the whole point of the scope, so the comparison is against the prefix
    // rather than the literal string.
    const prefixes = scopes.map((url) => url.replace(/\*$/, ""));
    expect(prefixes.some((prefix) => RELEASES_URL.startsWith(prefix))).toBe(true);
  });
});

describe("the desktop shell binary", () => {
  it("registers the plugin whose permission is granted", () => {
    // The other half of the same mistake: a scoped permission for a plugin the builder never
    // installed is a button that fails with "plugin opener not found".
    expect(read("../src-tauri/src/main.rs")).toContain("tauri_plugin_opener::init()");
  });
});
