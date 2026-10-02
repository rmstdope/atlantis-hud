import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { STANDARD_RAMPS } from "./biomeRamps";
import { type Field, type Ramp, fbm, mix, normalize, renderField, sineField } from "./biomeNoise";
import { SHAPES_FIELDS, SHAPES_RAMPS, drawShapes, groundSeed, shapePixelPass } from "./biomeShapes";

const OUT_DIR = path.resolve("config/public/biomes");
/** The Shapes set (ah-d9jb.2), served from `/biomes/shapes`. Only 512 px: the one size the map loads. */
const SHAPES_DIR = path.join(OUT_DIR, "shapes");
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
  "wasteland",
  "hill",
  "tunnels",
  "grotto",
  "deepforest",
  "chasm"
] as const;

function renderBiome(name: (typeof BIOMES)[number]): Buffer {
  const definitions: Record<(typeof BIOMES)[number], { field: Field; colours: Ramp; seed: number }> = {
    ocean: {
      field: normalize(mix(fbm(RENDER, 3, 6, 10), sineField(5, fbm(RENDER, 6, 5, 12), RENDER), 0.65, 0.35)),
      colours: STANDARD_RAMPS.ocean,
      seed: 11
    },
    plain: {
      field: normalize(mix(fbm(RENDER, 4, 6, 20), fbm(RENDER, 6, 4, 21), 0.6, 0.4)),
      colours: STANDARD_RAMPS.plain,
      seed: 22
    },
    forest: {
      field: normalize(mix(fbm(RENDER, 6, 6, 30), fbm(RENDER, 9, 5, 31), 0.45, 0.55)),
      colours: STANDARD_RAMPS.forest,
      seed: 33
    },
    mountain: {
      field: normalize(mix(fbm(RENDER, 3, 7, 40), fbm(RENDER, 4, 6, 41), 0.5, 0.5)),
      colours: STANDARD_RAMPS.mountain,
      seed: 44
    },
    swamp: {
      field: normalize(fbm(RENDER, 5, 6, 50)),
      colours: STANDARD_RAMPS.swamp,
      seed: 55
    },
    jungle: {
      field: normalize(mix(fbm(RENDER, 14, 6, 60), fbm(RENDER, 24, 6, 61), 0.5, 0.5)),
      colours: STANDARD_RAMPS.jungle,
      seed: 66
    },
    desert: {
      field: normalize(mix(sineField(7, fbm(RENDER, 4, 5, 70), RENDER), fbm(RENDER, 4, 5, 70), 0.7, 0.3)),
      colours: STANDARD_RAMPS.desert,
      seed: 77
    },
    tundra: {
      field: normalize(mix(fbm(RENDER, 4, 6, 80), fbm(RENDER, 9, 5, 81), 0.6, 0.4)),
      colours: STANDARD_RAMPS.tundra,
      seed: 88
    },
    volcano: {
      field: normalize(fbm(RENDER, 5, 7, 90)),
      colours: STANDARD_RAMPS.volcano,
      seed: 99
    },
    cavern: {
      field: normalize(mix(fbm(RENDER, 3, 7, 100), fbm(RENDER, 8, 5, 101), 0.65, 0.35)),
      colours: STANDARD_RAMPS.cavern,
      seed: 110
    },
    underforest: {
      field: normalize(mix(fbm(RENDER, 8, 6, 120), fbm(RENDER, 16, 5, 121), 0.5, 0.5)),
      colours: STANDARD_RAMPS.underforest,
      seed: 130
    },
    wasteland: {
      field: normalize(mix(fbm(RENDER, 4, 7, 140), sineField(6, fbm(RENDER, 7, 5, 141), RENDER), 0.7, 0.3)),
      colours: STANDARD_RAMPS.wasteland,
      seed: 150
    },
    hill: {
      field: normalize(mix(fbm(RENDER, 3, 7, 160), fbm(RENDER, 5, 5, 161), 0.7, 0.3)),
      colours: STANDARD_RAMPS.hill,
      seed: 160
    },
    tunnels: {
      field: normalize(mix(sineField(12, fbm(RENDER, 3, 4, 170), RENDER), fbm(RENDER, 5, 6, 171), 0.65, 0.35)),
      colours: STANDARD_RAMPS.tunnels,
      seed: 180
    },
    grotto: {
      field: normalize(mix(fbm(RENDER, 4, 6, 180), sineField(3, fbm(RENDER, 8, 4, 181), RENDER), 0.6, 0.4)),
      colours: STANDARD_RAMPS.grotto,
      seed: 190
    },
    deepforest: {
      field: normalize(mix(fbm(RENDER, 18, 7, 200), fbm(RENDER, 30, 6, 201), 0.55, 0.45)),
      colours: STANDARD_RAMPS.deepforest,
      seed: 210
    },
    chasm: {
      field: normalize(mix(sineField(9, fbm(RENDER, 4, 5, 220), RENDER), fbm(RENDER, 3, 7, 221), 0.72, 0.28)),
      colours: STANDARD_RAMPS.chasm,
      seed: 230
    }
  };
  const definition = definitions[name];
  return renderField(definition.field, definition.colours, definition.seed, RENDER);
}

async function writeComparisonSheet(masters: Map<string, Buffer>, directory: string) {
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
    .toFile(path.join(directory, "all_biomes.png"));
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
  await writeComparisonSheet(masters, OUT_DIR);
  console.log(`Wrote ${BIOMES.length * SIZES.length} textures + all_biomes.png to ${OUT_DIR}`);
  await writeShapesSet();
}

/** One Shapes tile: Standard's colours on the mockup's ground, the pixel pass, then the drawn shapes. */
async function renderShapes(name: (typeof BIOMES)[number]): Promise<Buffer> {
  const ground = renderField(SHAPES_FIELDS[name](RENDER), SHAPES_RAMPS[name], groundSeed(name), RENDER);
  shapePixelPass(name, ground, RENDER);
  const painter = drawShapes(name);
  if (painter.isEmpty()) {
    return ground;
  }
  return sharp(ground, { raw: { width: RENDER, height: RENDER, channels: 3 } })
    .composite([{ input: Buffer.from(painter.toSvg(RENDER)) }])
    .removeAlpha()
    .raw()
    .toBuffer();
}

async function writeShapesSet() {
  await mkdir(SHAPES_DIR, { recursive: true });
  const masters = new Map<string, Buffer>();
  for (const biome of BIOMES) {
    const master = await renderShapes(biome);
    masters.set(biome, master);
    await sharp(master, { raw: { width: RENDER, height: RENDER, channels: 3 } })
      .png()
      .toFile(path.join(SHAPES_DIR, `${biome}_${RENDER}.png`));
    console.log(`shapes ${biome.padEnd(11)} -> ${RENDER}`);
  }
  await writeComparisonSheet(masters, SHAPES_DIR);
  console.log(`Wrote ${BIOMES.length} textures + all_biomes.png to ${SHAPES_DIR}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
