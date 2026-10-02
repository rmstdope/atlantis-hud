import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DesktopUpdate } from "./updateCheck";
import {
  INITIAL_DESKTOP_UPDATE,
  LATEST_RELEASE_URL,
  RELEASES_URL,
  compareVersions,
  desktopUpdateState,
  readLatestRelease,
  reduceDesktopUpdate,
  releasePageUrl
} from "./updateCheck";

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

  it("lets the http plugin read the latest release, and nothing else on GitHub's API", () => {
    const http = capability.permissions.find(
      (permission) => typeof permission !== "string" && permission.identifier === "http:default"
    );
    const urls = typeof http === "string" ? [] : (http?.allow ?? []).map((entry) => entry.url);

    expect(urls).toContain(LATEST_RELEASE_URL);
    expect(urls.filter((url) => url?.startsWith("https://api.github.com"))).toEqual([
      LATEST_RELEASE_URL
    ]);
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
    expect(prefixes.some((prefix) => releasePageUrl("v0.26.0").startsWith(prefix))).toBe(true);
  });
});

describe("the desktop shell binary", () => {
  it("registers the plugin whose permission is granted", () => {
    // The other half of the same mistake: a scoped permission for a plugin the builder never
    // installed is a button that fails with "plugin opener not found".
    expect(read("../src-tauri/src/main.rs")).toContain("tauri_plugin_opener::init()");
  });
});

/** ah-sw92: reading GitHub's latest release and comparing it with the running build. */
describe("compareVersions", () => {
  it("orders by major, then minor, then patch, numerically", () => {
    expect(compareVersions("0.26.0", "0.25.2")).toBeGreaterThan(0);
    expect(compareVersions("0.25.10", "0.25.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.25.2", "0.25.2")).toBe(0);
    expect(compareVersions("0.25.1", "0.25.2")).toBeLessThan(0);
  });

  it("cannot compare a version that is not X.Y.Z", () => {
    expect(compareVersions("dev", "0.25.2")).toBeNull();
    expect(compareVersions("0.26.0", "dev")).toBeNull();
  });
});

describe("readLatestRelease", () => {
  const reply = (tag: unknown, status = 200) => ({ status, body: JSON.stringify({ tag_name: tag }) });

  it("finds a newer release, its plain version and its own page", () => {
    expect(readLatestRelease(reply("v0.26.0"), "0.25.2")).toEqual({
      version: "0.26.0",
      url: "https://github.com/rmstdope/atlantis-hud/releases/tag/v0.26.0"
    });
  });

  it("finds nothing newer when the release is the running version or older", () => {
    expect(readLatestRelease(reply("v0.25.2"), "0.25.2")).toBeNull();
    expect(readLatestRelease(reply("v0.24.0"), "0.25.2")).toBeNull();
  });

  it("never counts a release newer than a build with no comparable version", () => {
    expect(readLatestRelease(reply("v0.26.0"), "dev")).toBeNull();
  });

  it("calls anything that is not a readable release a failed check", () => {
    expect(readLatestRelease(reply("v0.26.0", 404), "0.25.2")).toBe("failed");
    expect(readLatestRelease(reply("v0.26.0", 403), "0.25.2")).toBe("failed");
    expect(readLatestRelease({ status: 200, body: "<html>" }, "0.25.2")).toBe("failed");
    expect(readLatestRelease(reply(42), "0.25.2")).toBe("failed");
    expect(readLatestRelease(reply("nightly"), "0.25.2")).toBe("failed");
  });
});

describe("reduceDesktopUpdate", () => {
  const release = { version: "0.26.0", url: releasePageUrl("v0.26.0") };
  const run = (...events: Parameters<typeof reduceDesktopUpdate>[1][]): DesktopUpdate =>
    events.reduce(reduceDesktopUpdate, INITIAL_DESKTOP_UPDATE);

  it("starts as nothing newer, nothing said", () => {
    expect(desktopUpdateState(INITIAL_DESKTOP_UPDATE)).toBe("idle");
    expect(INITIAL_DESKTOP_UPDATE.newer).toBeNull();
  });

  it("shows checking while any check runs, keeping a version already found", () => {
    const state = run({ type: "found", release }, { type: "started" });
    expect(desktopUpdateState(state)).toBe("checking");
    expect(state.newer).toEqual(release);
  });

  it("records a found release, and says the build is current when there is none", () => {
    expect(run({ type: "started" }, { type: "found", release }).newer).toEqual(release);
    const current = run({ type: "started" }, { type: "found", release: null });
    expect(current.newer).toBeNull();
    expect(desktopUpdateState(current)).toBe("current");
  });

  it("changes nothing on screen when an automatic check fails", () => {
    const before = run({ type: "started" }, { type: "found", release }, { type: "opened" });
    const after = reduceDesktopUpdate(reduceDesktopUpdate(before, { type: "started" }), {
      type: "failed",
      manual: false
    });
    expect(after).toEqual(before);
  });

  it("reports a failed manual check, with no newer version", () => {
    const state = run(
      { type: "found", release },
      { type: "started" },
      { type: "failed", manual: true }
    );
    expect(desktopUpdateState(state)).toBe("failed");
    expect(state.newer).toBeNull();
  });

  it("keeps the newer version once its page is opened", () => {
    const state = run({ type: "found", release }, { type: "opened" });
    expect(desktopUpdateState(state)).toBe("opened");
    expect(state.newer).toEqual(release);
  });
});
