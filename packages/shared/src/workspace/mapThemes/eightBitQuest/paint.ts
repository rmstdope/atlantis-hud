/**
 * Where 8-Bit Quest puts things, and what it draws them with.
 *
 * Everything this theme draws is a **bitmap**: a short array of equal-length strings, one
 * character per pixel, where `.` is transparent and every other character names a colour in
 * `PALETTE`. The terrain tiles are 4x4 bitmaps of 4-unit blocks; the sprites (castles, heroes,
 * knights, slimes, boats, swords) are small bitmaps of 1.5-2-unit pixels. A bitmap becomes SVG
 * `<rect>`s through `bitmapRects`, which merges each horizontal run of one colour into one rect, so
 * a sprite costs a couple of dozen elements rather than a hundred.
 *
 * The colours themselves live in `theme.css`, as `--eb-<name>` tokens: a bitmap names a colour, it
 * never holds one, so nothing here is a colour literal.
 *
 * Layout is a fixed **station grid**, as in a console game's HUD: each mark has its own square in
 * the hex, and a mark is either at its station or the station is empty. Coordinates are the
 * mockup's own (`.cerebro/scratch/themes/new-themes.html`, "8-Bit Quest"), drawn at radius 32; the
 * layers scale the whole hex down to `HEX_RADIUS` in one transform.
 */

import { markSpot, type MarkSpot } from "../biomeSymbols";
import type { BattleMark, HexView, SettlementTier } from "../hexView";
import type { TerrainPaint } from "../terrain";

/** The radius the mockup was drawn at. Everything below is in its coordinates. */
export const MOCKUP_RADIUS = 32;

/** One tile block: the chunky 4-pixel square of the mockup. */
export const TILE_BLOCK = 4;

/** A tile is 4x4 blocks, so 16 units square - two tiles from a hex's centre to its corner. */
export const TILE_SIZE = 16;

/**
 * The 8-bit palette, by the character a bitmap uses for it. Each name is a `--eb-<name>` token and
 * an `.eb-px-<name>` class in `theme.css`.
 */
export const PALETTE = {
  K: "black",
  W: "white",
  L: "silver",
  D: "grey",
  E: "slate",
  B: "blue",
  C: "sky",
  I: "ice",
  n: "navy",
  G: "green",
  g: "leaf",
  F: "pine",
  e: "deeppine",
  J: "jungle",
  M: "lime",
  N: "earth",
  H: "rust",
  O: "ochre",
  Y: "gold",
  S: "sand",
  T: "tan",
  R: "red",
  Q: "maroon",
  A: "lava",
  a: "ember",
  P: "skin",
  V: "violet",
  U: "indigo",
  X: "magenta",
  Z: "pink",
  t: "teal",
  c: "cyan",
} as const;

export type PaletteKey = keyof typeof PALETTE;
export type ColourName = (typeof PALETTE)[PaletteKey];

/** Rows of pixels; `.` is transparent, anything else a `PALETTE` key. */
export type Bitmap = readonly string[];

/** One run of same-coloured pixels, in the bitmap's own units, centred on the bitmap's middle. */
export type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  colour: ColourName;
};

function colourOf(key: string): ColourName {
  const colour = (PALETTE as Record<string, ColourName | undefined>)[key];
  if (!colour) {
    throw new Error(`8-Bit Quest: "${key}" is not a palette colour`);
  }
  return colour;
}

/**
 * A bitmap as rects of `px` units each, centred on (0, 0), with every horizontal run of one colour
 * merged into a single rect.
 *
 * Coordinates are rounded to three decimals so the markup is stable and short.
 */
export function bitmapRects(bitmap: Bitmap, px: number): PixelRect[] {
  const width = bitmap[0]?.length ?? 0;
  const height = bitmap.length;
  const left = (-width * px) / 2;
  const top = (-height * px) / 2;
  const rects: PixelRect[] = [];
  bitmap.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      const key = row[i];
      let run = 1;
      while (i + run < row.length && row[i + run] === key) {
        run += 1;
      }
      if (key !== ".") {
        rects.push({
          x: round(left + i * px),
          y: round(top + j * px),
          width: round(run * px),
          height: round(px),
          colour: colourOf(key),
        });
      }
      i += run;
    }
  });
  return rects;
}

function round(value: number): number {
  return Number(value.toFixed(3)) + 0;
}

/** A bitmap with one placeholder character swapped for a palette key: one shape, several liveries. */
export function tint(
  bitmap: Bitmap,
  placeholder: string,
  key: PaletteKey,
): Bitmap {
  return bitmap.map((row) => row.split(placeholder).join(key));
}

/** The colour most of a tile is made of: what the tile is painted as when zoomed too far for pixels. */
export function baseColour(bitmap: Bitmap): ColourName {
  const counts = new Map<string, number>();
  for (const row of bitmap) {
    for (const key of row) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const [key] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return colourOf(key);
}

/**
 * The terrain tiles, one per kind and one for a terrain the map has no paint for. Each is 4x4
 * blocks of `TILE_BLOCK` units, repeated across the hex by a pattern defined once in `Defs`.
 *
 * The first eight are the mockup's own tiles. The rest are this theme's inventions for the
 * terrains the mockup's map did not hold, each with a base of its own so the far band - which
 * paints every hex in its tile's base colour, since a 4-unit block is less than a screen pixel
 * there - still tells them apart.
 */
export const TILES: Record<TerrainPaint, Bitmap> = {
  // Pale wave crests on deep blue.
  ocean: ["BBBB", "CCBB", "BBBB", "BBCC"],
  // Light grass with darker tufts.
  plain: ["gggg", "gGgg", "gggG", "Gggg"],
  // A little pixel pine on dark green: crown, branches and a trunk.
  forest: ["FGFF", "GGGF", "FNFG", "FFGG"],
  // Grey rock with snowy caps and lighter scree.
  mountain: ["DWDD", "LDLD", "DDDW", "DLDD"],
  // Brown mud, green tufts and standing water.
  swamp: ["NNBN", "JNNN", "NNNN", "NBNJ"],
  // Gold sand with pale and dark grains.
  desert: ["SYYY", "YYOY", "YYYY", "YSYO"],
  // A brighter, busier green than the forest: dark leaves and lime shoots.
  jungle: ["FJJJ", "JMJJ", "JJFJ", "JJJM"],
  // Ochre bumps: a lit crest over a shadowed foot.
  hill: ["OOOO", "OYYO", "OOOO", "NOON"],
  // Pale ice with snow drifts and bare grey tufts.
  tundra: ["WIII", "IIID", "IIWI", "IDII"],
  // Dark red rock cracked with lava pixels.
  volcano: ["QQAQ", "QAaQ", "KQQQ", "QQKA"],
  // Rust-brown waste with dark cracks and pale dust.
  wasteland: ["HHNH", "HNHH", "SHHH", "HHHN"],
  // A violet crystal cave: indigo shadows and lilac glints.
  cavern: ["VVUV", "VZVV", "UVVV", "VVVU"],
  // Indigo underground wood with pink mushroom caps on white stems.
  underforest: ["UZUU", "UWUU", "UUUZ", "UUUW"],
  // Navy passages cut by black galleries.
  tunnels: ["nnnn", "KKnn", "nnnn", "nnKK"],
  // Teal water with glowing cyan pools.
  grotto: ["tttt", "tcct", "tttt", "cttt"],
  // Darker than the forest: deep pines in black shade.
  deepforest: ["eFee", "FFFe", "eKeF", "eeFF"],
  // Slate split by a black fissure.
  chasm: ["EEKE", "EKEE", "EEKE", "EKEE"],
  // The classic "missing texture" checker: a terrain the map has no tile for.
  other: ["XXKK", "XXKK", "KKXX", "KKXX"],
};

/** The id of a terrain's tile pattern, defined once in `Defs`. */
export function tileId(kind: TerrainPaint): string {
  return `eb-tile-${kind}`;
}

/** The checkerboard laid over a stale hex: every other block black. */
export const DITHER_ID = "eb-dither";
export const DITHER_CELL = TILE_BLOCK / 2;

/* ------------------------------------------------------------------------------------------- */
/* Sprites                                                                                      */
/* ------------------------------------------------------------------------------------------- */

/** Your own units: a little hero in a blue tunic. */
export const HERO: Bitmap = [
  "..KKKK..",
  ".KHHHHK.",
  ".KPPPPK.",
  "..KPPK..",
  ".KBBBBK.",
  "KPBBBBPK",
  ".KBKKBK.",
  ".KK..KK.",
];

/** Somebody else's units: a red knight with a silver helm. */
export const KNIGHT: Bitmap = [
  "..KKKK..",
  ".KLLLLK.",
  ".KLKKLK.",
  "..KLLK..",
  ".KRRRRK.",
  "KLRRRRLK",
  ".KRKKRK.",
  ".KK..KK.",
];

/** A monster: a green slime with white eyes. */
export const SLIME: Bitmap = [
  "........",
  "..KKKK..",
  ".KJJJJK.",
  "KJWJJWJK",
  "KJKJJKJK",
  "KJJJJJJK",
  "KJJJJJJK",
  ".KKKKKK.",
];

/** A village: one hut with a red roof. */
export const HUT: Bitmap = [
  "...K...",
  "..KRK..",
  ".KRRRK.",
  "KRRRRRK",
  ".KSSSK.",
  ".KSKSK.",
  ".KKKKK.",
];

/**
 * A settlement whose size the report never gave: the hut's shape, roofed in grey, so it claims no
 * tier it has no evidence for.
 */
export const HUT_UNKNOWN: Bitmap = tint(HUT, "R", "D");

/** A town: a three-towered keep. */
export const KEEP: Bitmap = [
  "KKK.KKK.KKK",
  "KLK.KLK.KLK",
  "KLKKKLKKKLK",
  "KLLLLLLLLLK",
  "KLLKLLLKLLK",
  "KLLLLLLLLLK",
  "KLLLKKKLLLK",
  "KLLLKKKLLLK",
  "KKKKKKKKKKK",
];

/** A city: a bigger castle, a tall flag-tower over its gate. */
export const CASTLE: Bitmap = [
  "......RR.....",
  "......RRR....",
  "......K......",
  ".....KLK.....",
  "KKK.KKLKK.KKK",
  "KLK.KLLLK.KLK",
  "KLKKKLWLKKKLK",
  "KLLLLLLLLLLLK",
  "KLLKLLLLLKLLK",
  "KLLLLKKKLLLLK",
  "KKKKKKKKKKKKK",
];

/** The guard's shield; `*` is the field, blue for your own guard and red for anyone else's. */
const SHIELD: Bitmap = [
  "KKKKKKK",
  "K**W**K",
  "K**W**K",
  "KWWWWWK",
  "K**W**K",
  ".K*W*K.",
  "..K*K..",
  "...K...",
];
export const GUARD_OWN: Bitmap = tint(SHIELD, "*", "B");
export const GUARD_FOREIGN: Bitmap = tint(SHIELD, "*", "R");

/** Crossed swords; `*` is the blade, `#` the hilt. */
const SWORDS: Bitmap = [
  "*.......*",
  ".*.....*.",
  "..*...*..",
  "...*.*...",
  "....*....",
  "...*.*...",
  "..#...#..",
  ".N.....N.",
  "N.......N",
];

/** The burst behind a battle the viewer fought in. */
export const EXPLOSION: Bitmap = [
  "....A....",
  ".A..a..A.",
  "..AaYaA..",
  "..aYYYa..",
  "AaYYWYYaA",
  "..aYYYa..",
  "..AaYaA..",
  ".A..a..A.",
  "....A....",
];
export const SWORDS_OWN: Bitmap = tint(tint(SWORDS, "*", "W"), "#", "Y");
/** A battle the viewer only watched: the same swords in grey, with no burst behind them. */
export const SWORDS_OTHER: Bitmap = tint(tint(SWORDS, "*", "L"), "#", "D");

/** A ship: a white sail on a brown hull. */
export const BOAT: Bitmap = [
  "...K....",
  "...KW...",
  "...KWW..",
  "...KWWW.",
  "KKKKKKKK",
  "KHHHHHHK",
  ".KHHHHK.",
];

/** Buildings: a workshop with a rust roof. */
export const HOUSE: Bitmap = [
  "..KKK..",
  ".KHHHK.",
  "KHHHHHK",
  ".KSSSK.",
  ".KSKSK.",
  ".KKKKK.",
];

/** A shaft: a ladder down into a black pit. */
export const SHAFT: Bitmap = [
  "DDDDDDD",
  "DKKKKKD",
  "DKTKTKD",
  "DKTTTKD",
  "DKTKTKD",
  "DKTTTKD",
  "DDDDDDD",
];

/** A lair: a cave mouth with red eyes in the dark. */
export const LAIR: Bitmap = [
  "..DDDDD..",
  ".DDKKKDD.",
  "DDKKKKKDD",
  "DKRKKKRKD",
  "DKKKKKKKD",
  "DDDDDDDDD",
];

/** A gate: a violet portal swirling pink and magenta. */
export const GATE: Bitmap = [
  "..KKK..",
  ".KVVVK.",
  "KVZZZVK",
  "KVZXZVK",
  "KVZXZVK",
  "KVZZZVK",
  "KVVVVVK",
  "KKKKKKK",
];

/** The "?" on ground nobody has visited. */
export const QUESTION: Bitmap = [
  ".LLL.",
  "L...L",
  "....L",
  "...L.",
  "..L..",
  ".....",
  "..L..",
];

/** Pixel sizes, in mockup units: settlements are the chunkiest sprite, units and icons smaller. */
export const SETTLEMENT_PX = 2;
export const SPRITE_PX = 1.5;
export const QUESTION_PX = 2;

/* ------------------------------------------------------------------------------------------- */
/* Layout                                                                                       */
/* ------------------------------------------------------------------------------------------- */

/**
 * The station grid. The settlement holds the middle and its name is printed under it; the units
 * stand along the southern edge (`UNIT_SLOTS`); the other marks hold a corner each, mirrored left
 * and right. The buildings stand just east of north, so a northern road is not buried under them.
 */
export const STATIONS = {
  settlement: { x: 0, y: -5 },
  buildings: { x: 8.5, y: -22 },
  guard: { x: -15.5, y: -14 },
  battle: { x: 14.5, y: -13 },
  gate: { x: -21, y: -3 },
  ship: { x: 21, y: -3 },
  shaft: { x: -20, y: 7 },
  lair: { x: 19, y: 7 },
  question: { x: 0, y: 0 },
} as const;

/** Where the settlement's name sits: the baseline, just under the castle. */
export const NAME_Y = 12;

/**
 * The unit row along the southern edge: a fixed slot per group, so a hex's own units always stand
 * in the same place. Your own units stand south-west and anyone else's south-east, leaving the
 * southern road clear between them; monsters, rarer in a hex than either, take the middle.
 */
export const UNIT_SLOTS = {
  own: { x: -13, y: 18 },
  foreign: { x: 13, y: 18 },
  monster: { x: 0, y: 20 },
} as const;

/** Where a sprite's count is printed, from the sprite's centre: at its lower right. */
export const COUNT_OFFSET = { x: 5, y: 7 };

export type UnitGroup = "own" | "foreign" | "monster";
export type UnitSprite = {
  group: UnitGroup;
  count: number;
  at: { x: number; y: number };
  bitmap: Bitmap;
};

const UNIT_BITMAPS: Record<UnitGroup, Bitmap> = {
  own: HERO,
  foreign: KNIGHT,
  monster: SLIME,
};

/**
 * The unit sprites: a hero for your own units, a knight for anyone else's, a slime for monsters,
 * each at its own slot with its count.
 *
 * The three groups partition the hex: the view model's `foreign` is the whole foreign tally with
 * the monsters still inside it, so drawing it directly would count every monster twice.
 */
export function unitRow(units: {
  own: number;
  foreign: number;
  monster: number;
}): UnitSprite[] {
  const groups: Array<{ group: UnitGroup; count: number }> = [
    { group: "own", count: units.own },
    { group: "foreign", count: units.foreign - units.monster },
    { group: "monster", count: units.monster },
  ];
  return groups
    .filter((group) => group.count > 0)
    .map((group) => ({
      ...group,
      at: UNIT_SLOTS[group.group],
      bitmap: UNIT_BITMAPS[group.group],
    }));
}

/** What a settlement is drawn as: a hut, a three-towered keep, or a flagged castle by tier. */
export function settlementSprite(tier: SettlementTier | null): Bitmap {
  if (tier === "city") {
    return CASTLE;
  }
  if (tier === "town") {
    return KEEP;
  }
  // An unknown tier gets the humblest sprite, roofed in grey: the name came from a neighbour's
  // exits, which never say how big a place is, and a castle there would claim a city on nothing.
  return tier === "village" ? HUT : HUT_UNKNOWN;
}

/** What a battle is drawn as: swords over a burst for the viewer's own fight, grey swords otherwise. */
export function battleSprites(battle: Exclude<BattleMark, null>): Bitmap[] {
  return battle === "own" ? [EXPLOSION, SWORDS_OWN] : [SWORDS_OTHER];
}

/**
 * Whether a hex nobody has visited carries the pixel "?". Not when a settlement stands there: the
 * castle holds the middle, and the rim already says the ground is unsurveyed.
 */
export function showsQuestion(view: HexView): boolean {
  return view.unsurveyed && view.settlement === null;
}

/** Whether `MarkLayer` draws anything in this hex at all - sprites only where a mark exists. */
export function hasMarks(view: HexView): boolean {
  return (
    view.settlement !== null ||
    view.units.own + view.units.foreign > 0 ||
    view.guard !== null ||
    view.battle !== null ||
    view.gate ||
    view.ships > 0 ||
    view.buildings > 0 ||
    view.shafts > 0 ||
    view.lairs > 0
  );
}

/** Half the larger side of a bitmap at `px`, plus a pixel of air: the room a sprite claims. */
export function spriteRoom(bitmap: Bitmap, px: number): number {
  return (Math.max(bitmap.length, bitmap[0]?.length ?? 0) * px) / 2 + px;
}

/**
 * Where this theme draws its marks in a hex, for the biome symbols to keep clear of (ah-d9jb.4).
 *
 * Read off the same stations and sprites `MarkLayer` draws with. The name is drawn at a constant
 * size on screen, so its room is a fair middle of how wide a name runs at the zooms the symbols
 * are shown at.
 */
export function markFootprint(view: HexView): MarkSpot[] {
  const spots: MarkSpot[] = [];
  const claim = (at: { x: number; y: number }, size: number) =>
    spots.push(markSpot(at, size, MOCKUP_RADIUS));

  if (view.settlement) {
    claim(
      STATIONS.settlement,
      spriteRoom(settlementSprite(view.settlement.tier), SETTLEMENT_PX),
    );
    claim({ x: 0, y: NAME_Y - 3 }, 10);
  } else if (showsQuestion(view)) {
    claim(STATIONS.question, spriteRoom(QUESTION, QUESTION_PX));
  }
  if (view.buildings > 0) {
    claim(STATIONS.buildings, spriteRoom(HOUSE, SPRITE_PX));
  }
  if (view.guard) {
    claim(STATIONS.guard, spriteRoom(SHIELD, SPRITE_PX));
  }
  if (view.battle) {
    claim(STATIONS.battle, spriteRoom(EXPLOSION, SPRITE_PX));
  }
  if (view.gate) {
    claim(STATIONS.gate, spriteRoom(GATE, SPRITE_PX));
  }
  if (view.ships > 0) {
    claim(STATIONS.ship, spriteRoom(BOAT, SPRITE_PX));
  }
  if (view.shafts > 0) {
    claim(STATIONS.shaft, spriteRoom(SHAFT, SPRITE_PX));
  }
  if (view.lairs > 0) {
    claim(STATIONS.lair, spriteRoom(LAIR, SPRITE_PX));
  }
  for (const unit of unitRow(view.units)) {
    claim(unit.at, spriteRoom(unit.bitmap, SPRITE_PX));
  }
  return spots;
}
