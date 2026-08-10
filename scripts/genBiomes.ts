import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.resolve("config/public/biomes");
const SIZES = [512, 256, 128, 64] as const;
const RENDER = 512;
const BIOMES = [
  "ocean",
  "plain",
  "forest",
  "mountain",
  "swamp",
  "jungle",
  "desert",
  "tundra",
  "volcano",
  "cavern",
  "underforest",
  "wasteland"
] as const;

type Rgb = readonly [number, number, number];
type Field = Float32Array;

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

function periodicValueNoise(size: number, period: number, seed: number): Field {
  const rng = random(seed);
  const lattice = Array.from({ length: period * period }, () => rng());
  const output = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const coordinateY = (y / size) * period;
    const y0 = Math.floor(coordinateY) % period;
    const y1 = (y0 + 1) % period;
    const fy = smoothstep(coordinateY - Math.floor(coordinateY));
    for (let x = 0; x < size; x += 1) {
      const coordinateX = (x / size) * period;
      const x0 = Math.floor(coordinateX) % period;
      const x1 = (x0 + 1) % period;
      const fx = smoothstep(coordinateX - Math.floor(coordinateX));
      const top = lattice[y0 * period + x0] * (1 - fx) + lattice[y0 * period + x1] * fx;
      const bottom =
        lattice[y1 * period + x0] * (1 - fx) + lattice[y1 * period + x1] * fx;
      output[y * size + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return output;
}

function fbm(size: number, period: number, octaves: number, seed: number): Field {
  const output = new Float32Array(size * size);
  let amplitude = 1;
  let amplitudeSum = 0;
  let currentPeriod = period;
  for (let octave = 0; octave < octaves; octave += 1) {
    const layer = periodicValueNoise(size, currentPeriod, seed + octave * 101);
    for (let index = 0; index < output.length; index += 1) {
      output[index] += layer[index] * amplitude;
    }
    amplitudeSum += amplitude;
    amplitude *= 0.5;
    currentPeriod *= 2;
  }
  for (let index = 0; index < output.length; index += 1) {
    output[index] /= amplitudeSum;
  }
  return output;
}

function normalize(field: Field): Field {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of field) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const scale = maximum - minimum || 1;
  return Float32Array.from(field, (value) => (value - minimum) / scale);
}

function blend(first: Rgb, second: Rgb, amount: number): Rgb {
  return [
    first[0] * (1 - amount) + second[0] * amount,
    first[1] * (1 - amount) + second[1] * amount,
    first[2] * (1 - amount) + second[2] * amount
  ];
}

function ramp(value: number, stops: readonly (readonly [number, Rgb])[]): Rgb {
  if (value <= stops[0][0]) {
    return stops[0][1];
  }
  for (let index = 1; index < stops.length; index += 1) {
    const [position, colour] = stops[index];
    if (value <= position) {
      const [previousPosition, previousColour] = stops[index - 1];
      return blend(previousColour, colour, (value - previousPosition) / (position - previousPosition));
    }
  }
  return stops[stops.length - 1][1];
}

function renderField(field: Field, colours: readonly (readonly [number, Rgb])[], seed: number) {
  const height = RENDER;
  const width = RENDER;
  const pixels = Buffer.alloc(width * height * 3);
  const noise = random(seed);
  for (let index = 0; index < field.length; index += 1) {
    const colour = ramp(field[index], colours);
    const grain = (noise() - 0.5) * 10;
    pixels[index * 3] = Math.max(0, Math.min(255, Math.round(colour[0] + grain)));
    pixels[index * 3 + 1] = Math.max(0, Math.min(255, Math.round(colour[1] + grain)));
    pixels[index * 3 + 2] = Math.max(0, Math.min(255, Math.round(colour[2] + grain)));
  }
  return pixels;
}

function mix(first: Field, second: Field, firstWeight: number, secondWeight: number): Field {
  return Float32Array.from(first, (value, index) => value * firstWeight + second[index] * secondWeight);
}

function sineField(frequency: number, warp: Field): Field {
  return Float32Array.from(warp, (value, index) => {
    const x = (index % RENDER) / RENDER;
    const y = Math.floor(index / RENDER) / RENDER;
    return 0.5 + 0.5 * Math.sin((x + y * 0.4) * Math.PI * 2 * frequency + value * 8);
  });
}

function renderBiome(name: (typeof BIOMES)[number]): Buffer {
  const definitions: Record<(typeof BIOMES)[number], { field: Field; colours: readonly (readonly [number, Rgb])[]; seed: number }> = {
    ocean: {
      field: normalize(mix(fbm(RENDER, 3, 6, 10), sineField(5, fbm(RENDER, 6, 5, 12)), 0.65, 0.35)),
      colours: [[0, [12, 42, 80]], [0.45, [18, 66, 116]], [0.75, [32, 104, 158]], [1, [150, 200, 220]]],
      seed: 11
    },
    plain: {
      field: normalize(mix(fbm(RENDER, 4, 6, 20), fbm(RENDER, 6, 4, 21), 0.6, 0.4)),
      colours: [[0, [86, 120, 46]], [0.5, [110, 152, 60]], [0.8, [140, 176, 78]], [1, [170, 196, 104]]],
      seed: 22
    },
    forest: {
      field: normalize(mix(fbm(RENDER, 6, 6, 30), fbm(RENDER, 9, 5, 31), 0.45, 0.55)),
      colours: [[0, [70, 58, 40]], [0.4, [74, 84, 44]], [0.7, [92, 110, 56]], [1, [128, 148, 82]]],
      seed: 33
    },
    mountain: {
      field: normalize(mix(fbm(RENDER, 3, 7, 40), fbm(RENDER, 4, 6, 41), 0.5, 0.5)),
      colours: [[0, [60, 58, 64]], [0.45, [96, 92, 96]], [0.7, [132, 128, 130]], [0.92, [215, 218, 224]], [1, [245, 248, 252]]],
      seed: 44
    },
    swamp: {
      field: normalize(fbm(RENDER, 5, 6, 50)),
      colours: [[0, [40, 52, 34]], [0.5, [62, 74, 44]], [0.8, [86, 96, 56]], [1, [110, 116, 70]]],
      seed: 55
    },
    jungle: {
      field: normalize(mix(fbm(RENDER, 14, 6, 60), fbm(RENDER, 24, 6, 61), 0.5, 0.5)),
      colours: [[0, [8, 40, 26]], [0.35, [16, 78, 34]], [0.65, [26, 122, 44]], [0.9, [60, 168, 58]], [1, [150, 210, 80]]],
      seed: 66
    },
    desert: {
      field: normalize(mix(sineField(7, fbm(RENDER, 4, 5, 70)), fbm(RENDER, 4, 5, 70), 0.7, 0.3)),
      colours: [[0, [196, 162, 96]], [0.5, [216, 184, 118]], [0.8, [232, 204, 142]], [1, [244, 224, 168]]],
      seed: 77
    },
    tundra: {
      field: normalize(mix(fbm(RENDER, 4, 6, 80), fbm(RENDER, 9, 5, 81), 0.6, 0.4)),
      colours: [[0, [150, 162, 170]], [0.4, [186, 196, 202]], [0.7, [212, 220, 226]], [1, [238, 244, 248]]],
      seed: 88
    },
    volcano: {
      field: normalize(fbm(RENDER, 5, 7, 90)),
      colours: [[0, [24, 20, 22]], [0.5, [44, 36, 36]], [0.85, [70, 58, 56]], [1, [96, 82, 78]]],
      seed: 99
    },
    cavern: {
      field: normalize(mix(fbm(RENDER, 3, 7, 100), fbm(RENDER, 8, 5, 101), 0.65, 0.35)),
      colours: [[0, [20, 24, 30]], [0.45, [46, 48, 56]], [0.75, [80, 76, 76]], [1, [132, 116, 92]]],
      seed: 110
    },
    underforest: {
      field: normalize(mix(fbm(RENDER, 8, 6, 120), fbm(RENDER, 16, 5, 121), 0.5, 0.5)),
      colours: [[0, [22, 42, 34]], [0.4, [38, 76, 48]], [0.75, [70, 112, 58]], [1, [120, 148, 72]]],
      seed: 130
    },
    wasteland: {
      field: normalize(mix(fbm(RENDER, 4, 7, 140), sineField(6, fbm(RENDER, 7, 5, 141)), 0.7, 0.3)),
      colours: [[0, [54, 44, 42]], [0.45, [92, 70, 56]], [0.75, [132, 100, 70]], [1, [184, 142, 92]]],
      seed: 150
    }
  };
  const definition = definitions[name];
  return renderField(definition.field, definition.colours, definition.seed);
}

async function writeComparisonSheet(masters: Map<string, Buffer>) {
  const cell = 220;
  const pad = 14;
  const labelHeight = 28;
  const columns = 3;
  const rows = Math.ceil(BIOMES.length / columns);
  const width = columns * cell + (columns + 1) * pad;
  const height = rows * (cell + labelHeight) + (rows + 1) * pad;
  const composites = [];
  for (const [index, name] of BIOMES.entries()) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = pad + column * (cell + pad);
    const y = pad + row * (cell + labelHeight + pad);
    const master = masters.get(name);
    if (!master) {
      throw new Error(`Missing generated master for biome: ${name}`);
    }
    composites.push({
      input: await sharp(master, {
        raw: { width: RENDER, height: RENDER, channels: 3 }
      })
        .resize(cell, cell)
        .png()
        .toBuffer(),
      left: x,
      top: y
    });
    composites.push({
      input: Buffer.from(
        `<svg width="${cell}" height="${labelHeight}"><text x="4" y="18" fill="#e8e8ec" font-family="monospace" font-size="14">${name.toUpperCase()}</text></svg>`
      ),
      left: x,
      top: y + cell
    });
  }
  await sharp({
    create: { width, height, channels: 3, background: { r: 26, g: 27, b: 31 } }
  })
    .composite(composites)
    .png()
    .toFile(path.join(OUT_DIR, "all_biomes.png"));
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const masters = new Map<string, Buffer>();
  for (const biome of BIOMES) {
    const master = renderBiome(biome);
    masters.set(biome, master);
    for (const size of SIZES) {
      await sharp(master, { raw: { width: RENDER, height: RENDER, channels: 3 } })
        .resize(size, size, { kernel: sharp.kernel.lanczos3 })
        .png()
        .toFile(path.join(OUT_DIR, `${biome}_${size}.png`));
    }
    console.log(`${biome.padEnd(11)} -> ${SIZES.join(", ")}`);
  }
  await writeComparisonSheet(masters);
  console.log(`Wrote ${BIOMES.length * SIZES.length} textures + all_biomes.png to ${OUT_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
