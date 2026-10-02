/**
 * OKLab and the colour difference the biome palette is judged by (ah-d9jb.1).
 *
 * The same maths as the agreed mockup (`docs/ui/ah-d9jb.1-texture-set.html`), so a number in a
 * test means what it meant when the palette was chosen. Differences are OKLab distances times 100.
 */

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

/** The 17 biomes that have a texture and a flat colour of their own. */
export const BIOMES = [
  "ocean",
  "plain",
  "forest",
  "mountain",
  "swamp",
  "desert",
  "jungle",
  "tundra",
  "volcano",
  "wasteland",
  "hill",
  "cavern",
  "underforest",
  "tunnels",
  "grotto",
  "deepforest",
  "chasm"
] as const;
export type Biome = (typeof BIOMES)[number];

/** The groups a person must tell apart at far zoom, from the bead's acceptance. */
export const CLASH_GROUPS: readonly (readonly Biome[])[] = [
  ["forest", "swamp", "jungle"],
  ["forest", "underforest", "deepforest", "jungle"],
  ["cavern", "tunnels", "chasm"],
  ["hill", "wasteland", "desert"],
  ["tundra", "mountain"]
];

/** Every pair inside a clash group, once. */
export function clashPairs(): [Biome, Biome][] {
  const pairs: [Biome, Biome][] = [];
  for (const group of CLASH_GROUPS) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        pairs.push([group[i], group[j]]);
      }
    }
  }
  return pairs;
}

export function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb;
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab(rgb: Rgb): Lab {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

export function difference(first: Rgb, second: Rgb): number {
  const a = rgbToLab(first);
  const b = rgbToLab(second);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}
