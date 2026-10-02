import type { Biome, Rgb } from "./colourDistance";

/**
 * The colour ramps of the Standard texture set (ah-d9jb.1), one per biome, dark to light.
 *
 * The noise each biome is drawn from is unchanged (`genBiomes.ts`); only these colours were
 * re-tuned, so that every biome has its own hue and lightness and the groups that clashed at far
 * zoom - forest, swamp and jungle above all - read apart. Agreed in
 * `docs/ui/ah-d9jb.1-texture-set.html`; tunnels was pushed darker and bluer than first drawn to
 * keep it off cavern.
 */
export const STANDARD_RAMPS: Record<Biome, readonly (readonly [number, Rgb])[]> = {
  ocean: [[0, [12, 42, 80]], [0.45, [18, 66, 116]], [0.75, [32, 104, 158]], [1, [120, 180, 210]]],
  plain: [[0, [120, 150, 70]], [0.5, [146, 176, 86]], [0.8, [170, 194, 104]], [1, [196, 210, 130]]],
  // Dark, cool blue-green.
  forest: [[0, [14, 40, 36]], [0.4, [26, 66, 54]], [0.7, [42, 94, 72]], [1, [86, 132, 104]]],
  mountain: [[0, [70, 70, 78]], [0.45, [104, 102, 108]], [0.75, [140, 138, 142]], [1, [190, 190, 196]]],
  // Muddy brown-olive, with teal-grey water in the low ground.
  swamp: [
    [0, [52, 78, 82]],
    [0.28, [70, 96, 96]],
    [0.34, [84, 80, 50]],
    [0.65, [116, 104, 62]],
    [1, [152, 138, 90]]
  ],
  desert: [[0, [200, 160, 92]], [0.5, [222, 186, 116]], [0.8, [236, 206, 142]], [1, [248, 228, 172]]],
  // Bright yellow-lime.
  jungle: [[0, [44, 96, 16]], [0.35, [84, 140, 24]], [0.7, [136, 178, 38]], [1, [196, 214, 84]]],
  tundra: [[0, [176, 190, 200]], [0.4, [200, 212, 220]], [0.7, [222, 230, 236]], [1, [244, 248, 252]]],
  volcano: [[0, [18, 14, 16]], [0.5, [38, 30, 30]], [0.85, [60, 48, 46]], [1, [84, 70, 66]]],
  wasteland: [[0, [96, 50, 36]], [0.45, [134, 74, 50]], [0.75, [162, 98, 66]], [1, [190, 130, 92]]],
  hill: [[0, [104, 92, 52]], [0.45, [136, 120, 70]], [0.75, [164, 148, 92]], [1, [196, 180, 124]]],
  // Grey-violet.
  cavern: [[0, [26, 24, 34]], [0.45, [50, 46, 62]], [0.75, [76, 70, 90]], [1, [112, 104, 128]]],
  underforest: [[0, [34, 30, 40]], [0.45, [56, 52, 52]], [0.75, [80, 76, 64]], [1, [110, 104, 80]]],
  // Dark blue.
  tunnels: [[0, [14, 20, 36]], [0.45, [24, 34, 58]], [0.75, [34, 48, 80]], [1, [52, 68, 104]]],
  grotto: [[0, [10, 30, 34]], [0.45, [20, 54, 58]], [0.75, [34, 82, 84]], [1, [70, 120, 118]]],
  deepforest: [[0, [4, 18, 14]], [0.45, [8, 32, 24]], [0.75, [14, 46, 34]], [1, [26, 66, 48]]],
  // Wine.
  chasm: [[0, [40, 18, 30]], [0.45, [66, 32, 46]], [0.75, [92, 48, 60]], [1, [124, 72, 80]]]
};
