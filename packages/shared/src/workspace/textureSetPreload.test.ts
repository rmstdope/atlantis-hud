import { describe, expect, it } from "vitest";
import { TERRAIN_KINDS } from "./mapThemes/terrain";
import { preloadTextureSet } from "./textureSetPreload";

describe("preloading a texture set", () => {
  it("asks for every biome picture of the chosen set's directory", async () => {
    const asked: string[] = [];
    await preloadTextureSet("painted", async (url) => {
      asked.push(url);
      return true;
    });

    expect(asked.sort()).toEqual(TERRAIN_KINDS.map((kind) => `/biomes/painted/${kind}_512.png`).sort());
  });

  it("settles only once every picture has answered", async () => {
    const pending: Array<(ok: boolean) => void> = [];
    let settled = false;
    const done = preloadTextureSet(
      "painted",
      () => new Promise<boolean>((resolve) => pending.push(resolve))
    ).then((shown) => {
      settled = true;
      return shown;
    });

    pending.slice(0, -1).forEach((resolve) => resolve(true));
    // A whole macrotask, so every promise hop an early-settling version would take has run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    pending[pending.length - 1](true);
    expect(await done).toEqual({ id: "painted", missing: [] });
  });

  it("names the biomes whose picture failed, so they stay flat", async () => {
    const shown = await preloadTextureSet("painted", async (url) => !/\/(swamp|chasm)_512/.test(url));

    expect(shown).toEqual({ id: "painted", missing: ["swamp", "chasm"] });
  });

  it("counts a loader that throws as a failed picture", async () => {
    const shown = await preloadTextureSet("standard", async (url) => {
      if (url.includes("ocean")) {
        throw new Error("network");
      }
      return true;
    });

    expect(shown).toEqual({ id: "standard", missing: ["ocean"] });
  });

  it("falls back to Standard for a set this build does not have", async () => {
    const asked: string[] = [];
    const shown = await preloadTextureSet("gone", async (url) => {
      asked.push(url);
      return true;
    });

    expect(shown.id).toBe("standard");
    expect(asked.every((url) => url.startsWith("/biomes/") && !url.includes("painted"))).toBe(true);
  });
});
