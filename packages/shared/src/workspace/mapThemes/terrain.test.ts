import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_WATER, terrainClassName, terrainKindOf, waterTerrainsOf } from "./terrain";

function ruleset(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../../config/public/${name}`, import.meta.url)),
    "utf8"
  );
}

describe("terrainKindOf", () => {
  it("keeps a terrain the map has paint for as its own kind, case-insensitively", () => {
    expect(terrainKindOf("DeepForest")).toBe("deepforest");
  });

  it("paints a word the ruleset calls water as ocean", () => {
    expect(terrainKindOf("lake", { ocean: "ocean", alsoWater: ["lake"] })).toBe("ocean");
  });

  it("paints the ruleset's own ocean terrain as ocean whatever it is called", () => {
    expect(terrainKindOf("Water", { ocean: "water", alsoWater: [] })).toBe("ocean");
  });

  it("does not treat a lake as water unless the ruleset says so", () => {
    expect(terrainKindOf("lake")).toBe("other");
  });

  it("falls back to other for a word it has no paint for", () => {
    expect(terrainKindOf("nexus")).toBe("other");
    expect(terrainKindOf("")).toBe("other");
  });
});

describe("waterTerrainsOf", () => {
  it("reads the ocean rule from the Trident ruleset", () => {
    expect(waterTerrainsOf(ruleset("ruleset-newage-trident.json"))).toEqual({
      ocean: "ocean",
      alsoWater: ["lake"]
    });
  });

  it("reads no extra water from the Origins ruleset", () => {
    expect(waterTerrainsOf(ruleset("ruleset.json"))).toEqual({ ocean: "ocean", alsoWater: [] });
  });

  it("falls back to the default on null, non-JSON and a missing ocean rule", () => {
    expect(waterTerrainsOf(null)).toEqual(DEFAULT_WATER);
    expect(waterTerrainsOf("not json")).toEqual(DEFAULT_WATER);
    expect(waterTerrainsOf("{}")).toEqual(DEFAULT_WATER);
  });

  it("lower-cases what it reads", () => {
    expect(
      waterTerrainsOf('{"movement":{"ocean":{"terrain":"Ocean","alsoWater":["Lake"]}}}')
    ).toEqual({ ocean: "ocean", alsoWater: ["lake"] });
  });
});

describe("terrainClassName", () => {
  it("names a theme's terrain class from its prefix", () => {
    expect(terrainClassName("hud", "grotto")).toBe("hud-terrain-grotto");
  });
});
