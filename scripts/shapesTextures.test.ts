import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { BIOMES, type Biome, CLASH_GROUPS, difference, type Rgb, rgbToLab } from "./colourDistance";

/**
 * The Shapes texture set as it ships (ah-d9jb.2): the committed images under
 * `config/public/biomes/shapes/`, read back the way a far-zoom map shows them.
 *
 * At far zoom a hex is 12-20 px across, so each tile is shrunk to 16 px and judged twice: by its
 * average colour, and by lightness alone - what a greyscale view, and largely a red-green
 * colour-blind one, is left with. Two biomes read apart in greyscale when their average lightness differs, or their light or dark extremes do:
 * tunnels' pale passages against chasm's black fissures, on grounds of much the same lightness.
 */

const DIRECTORY = path.resolve("config/public/biomes/shapes");
const FAR = 16;

/** The acceptance's groups: Standard's five, and grotto / ocean / swamp. */
const GROUPS: readonly (readonly Biome[])[] = [...CLASH_GROUPS, ["grotto", "ocean", "swamp"]];

type Lightness = { mean: number; dark: number; light: number; colour: Rgb };

async function farLightness(biome: Biome): Promise<Lightness> {
  const { data } = await sharp(path.join(DIRECTORY, `${biome}_512.png`))
    .removeAlpha()
    .resize(FAR, FAR, { kernel: sharp.kernel.lanczos3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const values: number[] = [];
  const sum = [0, 0, 0];
  for (let index = 0; index < data.length; index += 3) {
    values.push(rgbToLab([data[index], data[index + 1], data[index + 2]])[0] * 100);
    for (let channel = 0; channel < 3; channel += 1) {
      sum[channel] += data[index + channel];
    }
  }
  values.sort((a, b) => a - b);
  return {
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    dark: values[Math.floor(values.length * 0.1)],
    light: values[Math.floor(values.length * 0.9)],
    colour: sum.map((total) => total / values.length) as unknown as Rgb
  };
}

/**
 * Lightness, in OKLab L times 100, by which a pair's average, darkest tenth or lightest tenth must
 * differ. The closest pair as generated is grotto / ocean (4.8, their darkest tenths), which leans
 * on hue and grotto's drawn pools more than on lightness; every other pair clears 7.5.
 */
const LIGHTNESS_FLOOR = 4;
/** Average colour difference, the floor Standard's ramps are held to (`biomeRamps.test.ts`). */
const COLOUR_FLOOR = 5;

describe("the Shapes texture set's committed images", () => {
  const far = new Map<Biome, Lightness>();

  beforeAll(async () => {
    for (const biome of BIOMES) {
      if (existsSync(path.join(DIRECTORY, `${biome}_512.png`))) {
        far.set(biome, await farLightness(biome));
      }
    }
  });

  it("has a 512 px picture for every biome", async () => {
    for (const biome of BIOMES) {
      const file = path.join(DIRECTORY, `${biome}_512.png`);
      expect(existsSync(file), file).toBe(true);
      const { width, height } = await sharp(file).metadata();
      expect([width, height], biome).toEqual([512, 512]);
    }
  });

  it("draws mountain as dark rock that stands clear of tundra at far zoom", () => {
    const mountain = far.get("mountain");
    const tundra = far.get("tundra");
    expect(mountain && tundra).toBeTruthy();
    expect(tundra!.mean - mountain!.mean).toBeGreaterThan(25);
  });

  it("keeps every pair a person must tell apart apart at far zoom, in colour and in greyscale", () => {
    for (const group of GROUPS) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = far.get(group[i]);
          const b = far.get(group[j]);
          const pair = `${group[i]} / ${group[j]}`;
          expect(a && b, pair).toBeTruthy();
          const lightness = Math.max(
            Math.abs(a!.mean - b!.mean),
            Math.abs(a!.dark - b!.dark),
            Math.abs(a!.light - b!.light)
          );
          expect(lightness, `${pair} in greyscale`).toBeGreaterThanOrEqual(LIGHTNESS_FLOOR);
          expect(difference(a!.colour, b!.colour), `${pair} in colour`).toBeGreaterThanOrEqual(COLOUR_FLOOR);
        }
      }
    }
  });
});
