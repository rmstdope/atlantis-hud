import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BIOMES, clashPairs, difference, hexToRgb, rgbToLab, type Biome } from "./colourDistance";

/**
 * The flat terrain colours (textures off) of every map theme, dark and light (ah-d9jb.1).
 *
 * Read from the stylesheets themselves, so the test sees what ships. Two things are pinned: every
 * pair a person must tell apart at far zoom is apart, and each theme orders its biomes from dark to
 * light the way the agreed base palette does - the theme keeps its own band, the palette decides
 * the order.
 */

const THEMES_DIR = path.resolve("packages/shared/src/workspace/mapThemes");

/** The agreed base palette, from the bead's acceptance. */
const BASE: Record<Biome, string> = {
  ocean: "#2a5f8e",
  plain: "#a6bb6c",
  forest: "#2c5a48",
  mountain: "#8c8a92",
  swamp: "#7a6c46",
  desert: "#e2c48a",
  jungle: "#8cb42c",
  tundra: "#d6e0e8",
  volcano: "#3a2c2c",
  wasteland: "#9c5a3e",
  hill: "#9c8a56",
  cavern: "#4a4458",
  underforest: "#6a5a7a",
  tunnels: "#1c2a48",
  grotto: "#2c7a7c",
  deepforest: "#0e2a20",
  chasm: "#5c2c3e"
};

/** The colour sets each theme fills its hexes from; Miniature World has a lit and a shade face. */
const PALETTES: Record<string, readonly string[]> = {
  beveledTile: ["bt-terrain"],
  cartographersTable: ["ct-terrain"],
  emblemAndDots: ["ed-terrain"],
  tacticalHud: ["hud-terrain"],
  miniatureWorld: ["mw-lit", "mw-shade"]
};

/** Below this two hexes read as one colour at a glance; every theme's closest pair was 0.5-3 before. */
const FLOOR = 5;

function palettes() {
  const found: { name: string; colours: Record<Biome, string> }[] = [];
  for (const [theme, prefixes] of Object.entries(PALETTES)) {
    const css = readFileSync(path.join(THEMES_DIR, theme, "theme.css"), "utf8");
    const lightAt = css.indexOf(':root[data-theme="light"]');
    const variants = { dark: css.slice(0, lightAt), light: css.slice(lightAt) };
    for (const [variant, block] of Object.entries(variants)) {
      for (const prefix of prefixes) {
        const colours = Object.fromEntries(
          BIOMES.map((biome) => {
            const match = block.match(new RegExp(`--${prefix}-${biome}: (#[0-9a-f]{6});`));
            if (!match) {
              throw new Error(`${theme} ${variant} has no --${prefix}-${biome}`);
            }
            return [biome, match[1]];
          })
        ) as Record<Biome, string>;
        found.push({ name: `${theme} ${variant} ${prefix}`, colours });
      }
    }
  }
  return found;
}

const lightness = (hex: string) => rgbToLab(hexToRgb(hex))[0];

/**
 * Pairs the base palette puts at different lightness. Biomes it holds level (grotto, swamp and
 * wasteland lie within 0.004; hill and mountain within 0.0003) may swap by a rounding step in a
 * theme, which nobody can see, so only a real difference in the palette has to survive.
 */
const ORDERED_PAIRS = BIOMES.flatMap((a) =>
  BIOMES.filter((b) => lightness(BASE[b]) - lightness(BASE[a]) >= 0.01).map(
    (b) => [a, b] as const
  )
);

describe.each(palettes())("the flat terrain colours of $name", ({ colours }) => {
  it.each(clashPairs())("tell %s from %s at a glance", (first, second) => {
    expect(difference(hexToRgb(colours[first]), hexToRgb(colours[second]))).toBeGreaterThanOrEqual(
      FLOOR
    );
  });

  it("order the biomes from dark to light as the agreed palette does", () => {
    const outOfOrder = ORDERED_PAIRS.filter(
      ([darker, lighter]) => lightness(colours[darker]) >= lightness(colours[lighter])
    );
    expect(outOfOrder).toEqual([]);
  });
});
