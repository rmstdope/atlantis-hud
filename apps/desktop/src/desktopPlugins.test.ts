import { afterEach, describe, expect, it } from "vitest";
import { desktopPlugins, type DesktopPlugins } from "./desktopPlugins";

/**
 * vitest here runs without a DOM (no jsdom config for `apps/desktop`), so `window` does not exist
 * until a test puts one there - which is also how a test stands in for the global a Playwright
 * `addInitScript` would install before the bundle loads.
 */
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("desktopPlugins", () => {
  it("returns the stand-in a test installed, before anything else is asked", () => {
    const fake: DesktopPlugins = {
      save: async () => "/fake/path",
      writeTextFile: async () => undefined,
      httpRequest: async () => ({ status: 200, body: "" })
    };
    (globalThis as unknown as { window: { __ATLANTIS_DESKTOP_PLUGINS__?: DesktopPlugins } }).window =
      { __ATLANTIS_DESKTOP_PLUGINS__: fake };

    expect(desktopPlugins()).toBe(fake);
  });

  it("returns undefined with no stand-in and no Tauri runtime", () => {
    (globalThis as unknown as { window: Record<string, unknown> }).window = {};

    expect(desktopPlugins()).toBeUndefined();
  });

  it("returns undefined when there is no window at all", () => {
    expect(desktopPlugins()).toBeUndefined();
  });
});
