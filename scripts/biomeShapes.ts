import { STANDARD_RAMPS } from "./biomeRamps";
import { type Field, type Ramp, fbm, mix, normalize, random, sineField } from "./biomeNoise";
import type { Biome } from "./colourDistance";
import { SvgPainter } from "./svgPainter";

/**
 * The Shapes texture set (ah-d9jb.2): Standard's colours with one large drawn shape per biome, so a
 * biome can be told by its structure as well as its colour - in greyscale and for red-green colour
 * blindness too.
 *
 * Ported from the agreed mockup, `docs/ui/ah-d9jb.2-shapes-set.html` (option B of the spike, its
 * `SHAPES`), with the two changes agreed there: mountain is dark rock with small snow tips (it faded
 * into tundra at far zoom), and ocean has no marks at all, only broad shallows and deeps (its short
 * arcs read as birds). The drawing is in the mockup's own 256-unit tile and is rasterised larger.
 */

/** The mockup's tile, in which every shape below is placed and sized. */
export const TILE = 256;

type Painter = SvgPainter;
type Rng = () => number;
type Pt = [number, number];

/** Mountain's rock, much darker than Standard's so the white snow tips stand out against tundra. */
const DARK_MOUNTAIN: Ramp = [
  [0, [44, 44, 52]],
  [0.45, [70, 68, 78]],
  [0.75, [98, 96, 106]],
  [1, [136, 134, 144]]
];

export const SHAPES_RAMPS: Record<Biome, Ramp> = { ...STANDARD_RAMPS, mountain: DARK_MOUNTAIN };

/** The ground beneath each shape, the mockup's `FIELDS`. */
export const SHAPES_FIELDS: Record<Biome, (size: number) => Field> = {
  ocean: (s) => normalize(mix(fbm(s, 3, 6, 10), sineField(5, fbm(s, 6, 5, 12), s), 0.65, 0.35)),
  plain: (s) => normalize(mix(fbm(s, 4, 6, 20), fbm(s, 6, 4, 21), 0.6, 0.4)),
  forest: (s) => normalize(mix(fbm(s, 6, 6, 30), fbm(s, 9, 5, 31), 0.45, 0.55)),
  mountain: (s) => normalize(mix(fbm(s, 3, 7, 40), fbm(s, 4, 6, 41), 0.5, 0.5)),
  swamp: (s) => normalize(fbm(s, 5, 6, 50)),
  desert: (s) => normalize(mix(sineField(7, fbm(s, 4, 5, 70), s), fbm(s, 4, 5, 70), 0.7, 0.3)),
  jungle: (s) => normalize(mix(fbm(s, 14, 6, 60), fbm(s, 24, 6, 61), 0.5, 0.5)),
  tundra: (s) => normalize(mix(fbm(s, 4, 6, 80), fbm(s, 9, 5, 81), 0.6, 0.4)),
  volcano: (s) => normalize(fbm(s, 5, 7, 90)),
  wasteland: (s) => normalize(mix(fbm(s, 4, 7, 140), fbm(s, 7, 5, 141), 0.7, 0.3)),
  hill: (s) => normalize(mix(fbm(s, 3, 7, 160), fbm(s, 5, 5, 161), 0.7, 0.3)),
  cavern: (s) => normalize(mix(fbm(s, 3, 7, 100), fbm(s, 8, 5, 101), 0.65, 0.35)),
  underforest: (s) => normalize(mix(fbm(s, 8, 6, 120), fbm(s, 16, 5, 121), 0.5, 0.5)),
  tunnels: (s) => normalize(fbm(s, 5, 6, 171)),
  grotto: (s) => normalize(mix(fbm(s, 4, 6, 180), sineField(3, fbm(s, 8, 4, 181), s), 0.6, 0.4)),
  deepforest: (s) => normalize(mix(fbm(s, 18, 7, 200), fbm(s, 30, 6, 201), 0.55, 0.45)),
  chasm: (s) => normalize(fbm(s, 3, 7, 221))
};

/** The grain seed of the ground, as the mockup's `base()` chose it. */
export function groundSeed(kind: Biome): number {
  return 7 + kind.length;
}

/** FNV-1a, the mockup's `hash`: each biome's shapes get their own random sequence. */
export function hash(text: string): number {
  let value = 2166136261;
  for (const character of text) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Draws at (x, y) and again wherever the shape spills over an edge, so the tile has no seam. */
export function wrapDraw(x: number, y: number, r: number, draw: (x: number, y: number) => void) {
  for (const dx of [-TILE, 0, TILE]) {
    for (const dy of [-TILE, 0, TILE]) {
      if (x + dx + r < 0 || x + dx - r > TILE || y + dy + r < 0 || y + dy - r > TILE) {
        continue;
      }
      draw(x + dx, y + dy);
    }
  }
}

/**
 * The value the first copy of a wrapped shape drew, for every copy. The mockup drew a fresh random
 * value per copy, which never showed there (each hex was one untiled image) but cuts the shape at
 * the seam once the map tiles the picture. Each copy still draws its value, and throws it away, so
 * the random sequence - and so every other shape - stays the agreed one.
 */
function sameForEveryCopy<T>(first: T | undefined, drawn: T): T {
  return first === undefined ? drawn : first;
}

const rgb = (c: readonly number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const FULL = 7;

function jaggedLine(ctx: Painter, rng: Rng, x: number, y: number, angle: number, length: number, step: number, wobble: number) {
  ctx.moveTo(x, y);
  for (let d = 0; d < length; d += step) {
    angle += (rng() - 0.5) * wobble;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
    ctx.lineTo(x, y);
  }
}

function polygon(ctx: Painter, colour: string, points: Pt[]) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) {
    ctx.lineTo(...point);
  }
  ctx.fill();
}

function disc(ctx: Painter, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, FULL);
  ctx.fill();
}

/** Swamp's ground noise: low ground is open water, the shore just above it carries the reeds. */
function swampWater(size: number): Field {
  return normalize(fbm(size, 4, 5, 501));
}

/** Broad lighter shallows and darker deeps on the ocean, the agreed replacement for wave marks. */
function oceanDepths(size: number): Field {
  return normalize(fbm(size, 3, 4, 909));
}

/**
 * What the shapes change pixel by pixel rather than by drawing: swamp's open water, ocean's
 * shallows and deeps. Applied to the ground before the drawn shapes go over it.
 */
export function shapePixelPass(kind: Biome, pixels: Buffer, size: number) {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  if (kind === "swamp") {
    const n = swampWater(size);
    for (let i = 0; i < n.length; i += 1) {
      if (n[i] < 0.42) {
        const depth = (0.42 - n[i]) / 0.42;
        const colour = n[i] > 0.38 ? [60, 66, 44] : [64 + depth * 20, 104 + depth * 26, 112 + depth * 34];
        pixels[i * 3] = clamp(colour[0]);
        pixels[i * 3 + 1] = clamp(colour[1]);
        pixels[i * 3 + 2] = clamp(colour[2]);
      }
    }
  } else if (kind === "ocean") {
    const n = oceanDepths(size);
    for (let i = 0; i < n.length; i += 1) {
      const k = n[i] > 0.62 ? 26 : n[i] < 0.3 ? -14 : 0;
      pixels[i * 3] = clamp(pixels[i * 3] + k * 0.6);
      pixels[i * 3 + 1] = clamp(pixels[i * 3 + 1] + k);
      pixels[i * 3 + 2] = clamp(pixels[i * 3 + 2] + k);
    }
  }
}

function peaks(ctx: Painter, rng: Rng, lit: string, shade: string, snow: number) {
  for (let i = 0; i < 16; i += 1) {
    const x = rng() * TILE;
    const y = rng() * TILE;
    const w = 30 + rng() * 22;
    const h = w * (0.8 + rng() * 0.3);
    const skew = (rng() - 0.5) * w * 0.4;
    wrapDraw(x, y, w + 4, (px, py) => {
      const top: Pt = [px + skew, py - h / 2];
      const left: Pt = [px - w / 2, py + h / 2];
      const right: Pt = [px + w / 2, py + h / 2];
      const mid: Pt = [px + skew * 0.3, py + h / 2];
      polygon(ctx, lit, [top, left, mid]);
      polygon(ctx, shade, [top, mid, right]);
      const lerp = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * snow, a[1] + (b[1] - a[1]) * snow];
      polygon(ctx, "rgb(244,246,250)", [top, lerp(top, left), lerp(top, mid), lerp(top, right)]);
    });
  }
}

const SHAPES: Record<Biome, (ctx: Painter, rng: Rng) => void> = {
  // No marks: the shallows and deeps are the pixel pass's.
  ocean() {},
  plain(ctx, rng) {
    ctx.lineCap = "round";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 110; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const h = 4 + rng() * 4;
      wrapDraw(x, y, 8, (px, py) => {
        ctx.strokeStyle = "rgba(80,104,40,0.8)";
        for (const dx of [-2, 0, 2]) {
          ctx.beginPath();
          ctx.moveTo(px + dx, py);
          ctx.lineTo(px + dx * 1.8, py - h);
          ctx.stroke();
        }
      });
    }
  },
  forest(ctx, rng) {
    ctx.fillStyle = "rgb(12,32,28)";
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 90; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 10 + rng() * 9;
      const t = rng();
      wrapDraw(x, y, r + 5, (px, py) => {
        ctx.fillStyle = "rgba(0,10,8,0.55)";
        disc(ctx, px + 3, py + 4, r);
        const g = ctx.createRadialGradient(px - r * 0.35, py - r * 0.35, r * 0.1, px, py, r);
        g.addColorStop(0, rgb([70 + t * 30, 128 + t * 20, 100]));
        g.addColorStop(0.6, rgb([30, 78 + t * 18, 60]));
        g.addColorStop(1, rgb([16, 46, 38]));
        ctx.fillStyle = g;
        disc(ctx, px, py, r);
      });
    }
  },
  // Dark rock with small snow tips (the agreed fix): dark grey with white points at far zoom.
  mountain(ctx, rng) {
    peaks(ctx, rng, "rgb(112,110,120)", "rgb(40,38,48)", 0.22);
  },
  swamp(ctx, rng) {
    const n = swampWater(TILE);
    ctx.lineCap = "round";
    for (let i = 0; i < 90; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const index = (y | 0) * TILE + (x | 0);
      if (n[index] < 0.4 || n[index] > 0.65) {
        continue;
      }
      const heights = [0, 1, 2, 3, 4].map(() => 9 + rng() * 7);
      wrapDraw(x, y, 16, (px, py) => {
        for (let k = 0; k < 5; k += 1) {
          const ox = (k - 2) * 2.4;
          const h = heights[k];
          ctx.strokeStyle = k % 2 ? "rgb(56,58,26)" : "rgb(160,150,76)";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(px + ox, py);
          ctx.quadraticCurveTo(px + ox + (k - 2) * 1.5, py - h * 0.6, px + ox + (k - 2) * 2.4, py - h);
          ctx.stroke();
        }
      });
    }
  },
  desert(ctx, rng) {
    ctx.lineCap = "round";
    for (let i = 0; i < 22; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const w = 26 + rng() * 22;
      wrapDraw(x, y, w + 6, (px, py) => {
        ctx.fillStyle = "rgba(150,104,52,0.45)";
        ctx.beginPath();
        ctx.ellipse(px, py + 5, w, w * 0.32, 0, 0, Math.PI);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,244,210,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(px, py, w, w * 0.3, 0, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      });
    }
  },
  jungle(ctx, rng) {
    ctx.fillStyle = "rgb(40,92,14)";
    ctx.fillRect(0, 0, TILE, TILE);
    const leaf = (px: number, py: number, angle: number, length: number, width: number, colour: string) => {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(10,40,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(length / 2 + 2, 3, length / 2, width, 0, 0, FULL);
      ctx.fill();
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.ellipse(length / 2, 0, length / 2, width, 0, 0, FULL);
      ctx.fill();
      ctx.strokeStyle = "rgba(230,240,120,0.75)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(1, 0);
      ctx.lineTo(length - 2, 0);
      ctx.stroke();
      ctx.restore();
    };
    const colours = [
      [70, 140, 20],
      [110, 170, 30],
      [150, 196, 50],
      [190, 214, 80]
    ];
    for (let i = 0; i < 70; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const length = 16 + rng() * 14;
      const spokes = 5 + ((rng() * 4) | 0);
      const rotation = rng() * 6.3;
      const width = 4 + rng() * 2;
      const colour = rgb(colours[(rng() * 4) | 0]);
      wrapDraw(x, y, length + 6, (px, py) => {
        for (let s = 0; s < spokes; s += 1) {
          leaf(px, py, rotation + (s * 6.283) / spokes, length, width, colour);
        }
      });
    }
  },
  tundra(ctx, rng) {
    for (let i = 0; i < 26; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 6 + rng() * 10;
      let rotation: number | undefined;
      wrapDraw(x, y, r, (px, py) => {
        ctx.fillStyle = "rgba(120,140,110,0.45)";
        ctx.beginPath();
        rotation = sameForEveryCopy(rotation, rng() * 3);
        ctx.ellipse(px, py, r, r * 0.6, rotation, 0, FULL);
        ctx.fill();
      });
    }
    ctx.strokeStyle = "rgba(110,150,190,0.8)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 18; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      let angle: number | undefined;
      wrapDraw(x, y, 30, (px, py) => {
        ctx.beginPath();
        angle = sameForEveryCopy(angle, rng() * 6.3);
        jaggedLine(ctx, random(i + 7), px, py, angle, 26, 4, 1.4);
        ctx.stroke();
      });
    }
    for (let i = 0; i < 40; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 1.5 + rng() * 2.5;
      wrapDraw(x, y, r + 2, (px, py) => {
        ctx.fillStyle = "rgb(96,100,108)";
        disc(ctx, px, py, r);
      });
    }
  },
  volcano(ctx, rng) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < 16; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const angle = rng() * 6.3;
      const seed = i * 31 + 5;
      // A crack reaches 45 units, its glow about 12 more (blur 8); the mockup's 50 cut the glow.
      wrapDraw(x, y, 60, (px, py) => {
        for (const [width, colour, blur] of [
          [5, "rgba(255,80,10,0.5)", 8],
          [2.2, "rgb(255,150,40)", 0],
          [0.8, "rgb(255,236,140)", 0]
        ] as const) {
          ctx.shadowColor = "rgba(255,90,0,0.9)";
          ctx.shadowBlur = blur;
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.beginPath();
          jaggedLine(ctx, random(seed), px, py, angle, 44, 5, 1.2);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      });
    }
    for (let i = 0; i < 4; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 9 + rng() * 6;
      wrapDraw(x, y, r + 4, (px, py) => {
        ctx.fillStyle = "rgb(10,8,8)";
        disc(ctx, px, py, r);
        ctx.fillStyle = "rgb(230,90,20)";
        disc(ctx, px, py, r * 0.45);
      });
    }
  },
  wasteland(ctx, rng) {
    ctx.strokeStyle = "rgba(48,22,14,0.85)";
    ctx.lineWidth = 1.6;
    ctx.lineJoin = "round";
    const points = Array.from({ length: 40 }, (): Pt => [rng() * TILE, rng() * TILE]);
    for (const [x, y] of points) {
      const near = points
        .map(([u, v]) => [u, v, Math.hypot(u - x, v - y)] as const)
        .filter((point) => point[2] > 0)
        .sort((a, b) => a[2] - b[2])
        .slice(0, 3);
      for (const [u, v, d] of near) {
        if (d < 60) {
          let jitter: Pt | undefined;
          wrapDraw(x, y, 60, (px, py) => {
            ctx.beginPath();
            ctx.moveTo(px, py);
            const drawn: Pt = [(rng() - 0.5) * 6, (rng() - 0.5) * 6];
            jitter = sameForEveryCopy(jitter, drawn);
            ctx.lineTo(px + (u - x) * 0.5 + jitter[0], py + (v - y) * 0.5 + jitter[1]);
            ctx.lineTo(px + u - x, py + v - y);
            ctx.stroke();
          });
        }
      }
    }
    for (let i = 0; i < 24; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 2 + rng() * 3;
      wrapDraw(x, y, r + 2, (px, py) => {
        ctx.fillStyle = "rgb(70,54,46)";
        disc(ctx, px, py, r);
        ctx.fillStyle = "rgba(220,180,140,0.6)";
        disc(ctx, px - r * 0.3, py - r * 0.3, r * 0.4);
      });
    }
  },
  hill(ctx, rng) {
    for (let i = 0; i < 26; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 18 + rng() * 14;
      wrapDraw(x, y, r + 6, (px, py) => {
        ctx.fillStyle = "rgba(60,48,24,0.4)";
        ctx.beginPath();
        ctx.ellipse(px + 5, py + 5, r, r * 0.75, 0, 0, FULL);
        ctx.fill();
        const g = ctx.createRadialGradient(px - r * 0.4, py - r * 0.4, r * 0.1, px, py, r);
        g.addColorStop(0, "rgb(214,200,140)");
        g.addColorStop(0.55, "rgb(160,142,84)");
        g.addColorStop(1, "rgb(110,96,54)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.75, 0, 0, FULL);
        ctx.fill();
      });
    }
  },
  cavern(ctx, rng) {
    for (let i = 0; i < 34; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 6 + rng() * 10;
      wrapDraw(x, y, r + 4, (px, py) => {
        ctx.fillStyle = "rgba(8,6,14,0.6)";
        ctx.beginPath();
        ctx.ellipse(px + 3, py + 3, r, r * 0.8, 0, 0, FULL);
        ctx.fill();
        const g = ctx.createRadialGradient(px - r * 0.4, py - r * 0.4, 1, px, py, r);
        g.addColorStop(0, "rgb(170,150,200)");
        g.addColorStop(0.5, "rgb(88,80,108)");
        g.addColorStop(1, "rgb(40,36,52)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * 0.8, 0, 0, FULL);
        ctx.fill();
      });
    }
  },
  underforest(ctx, rng) {
    ctx.fillStyle = "rgb(30,26,36)";
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 60; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 9 + rng() * 9;
      const t = rng();
      wrapDraw(x, y, r + 5, (px, py) => {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        disc(ctx, px + 3, py + 4, r);
        const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, 1, px, py, r);
        g.addColorStop(0, rgb([180 + t * 30, 150, 200]));
        g.addColorStop(0.7, rgb([110 + t * 30, 80, 130]));
        g.addColorStop(1, rgb([60, 40, 70]));
        ctx.fillStyle = g;
        disc(ctx, px, py, r);
        ctx.fillStyle = "rgba(240,230,200,0.8)";
        for (let k = 0; k < 3; k += 1) {
          disc(ctx, px + Math.cos(k * 2.1 + t * 6) * r * 0.5, py + Math.sin(k * 2.1 + t * 6) * r * 0.5, r * 0.12);
        }
      });
    }
  },
  tunnels(ctx, rng) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < 7; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const angle = rng() * 6.3;
      const seed = i * 17 + 3;
      wrapDraw(x, y, 120, (px, py) => {
        for (const [width, colour] of [
          [14, "rgb(10,12,16)"],
          [9, "rgb(120,130,150)"],
          [4, "rgb(170,180,196)"]
        ] as const) {
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.beginPath();
          jaggedLine(ctx, random(seed), px, py, angle, 110, 8, 0.7);
          ctx.stroke();
        }
      });
    }
  },
  grotto(ctx, rng) {
    for (let i = 0; i < 10; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 14 + rng() * 14;
      wrapDraw(x, y, r + 4, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 1, px, py, r);
        g.addColorStop(0, "rgb(150,250,236)");
        g.addColorStop(0.6, "rgb(40,170,170)");
        g.addColorStop(1, "rgba(20,80,84,0)");
        ctx.fillStyle = g;
        disc(ctx, px, py, r);
      });
    }
    for (let i = 0; i < 26; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const h = 6 + rng() * 6;
      const angle = (rng() - 0.5) * 0.8;
      wrapDraw(x, y, h + 2, (px, py) => {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        polygon(ctx, "rgb(220,250,255)", [[0, -h], [2.5, 0], [-2.5, 0]]);
        polygon(ctx, "rgb(110,190,210)", [[0, -h], [2.5, 0], [0, 0]]);
        ctx.restore();
      });
    }
  },
  deepforest(ctx, rng) {
    ctx.fillStyle = "rgb(2,10,8)";
    ctx.fillRect(0, 0, TILE, TILE);
    for (let i = 0; i < 140; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const r = 6 + rng() * 6;
      const t = rng();
      wrapDraw(x, y, r + 3, (px, py) => {
        const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, 1, px, py, r);
        g.addColorStop(0, rgb([26, 70 + t * 20, 50]));
        g.addColorStop(1, rgb([6, 24, 18]));
        ctx.fillStyle = g;
        disc(ctx, px, py, r);
      });
    }
    for (let i = 0; i < 70; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      // The mockup's 4 let a speck's glow be cut at the tile edge; 8 covers the blur.
      wrapDraw(x, y, 8, (px, py) => {
        ctx.shadowColor = "rgb(80,255,230)";
        ctx.shadowBlur = 5;
        ctx.fillStyle = "rgb(160,255,240)";
        disc(ctx, px, py, 1.3);
        ctx.shadowBlur = 0;
      });
    }
  },
  chasm(ctx, rng) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < 5; i += 1) {
      const x = rng() * TILE;
      const y = rng() * TILE;
      const angle = rng() * 6.3;
      const seed = i * 23 + 9;
      wrapDraw(x, y, 130, (px, py) => {
        for (const [width, colour] of [
          [16, "rgb(150,90,96)"],
          [12, "rgb(20,6,12)"],
          [5, "rgb(0,0,0)"]
        ] as const) {
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.beginPath();
          jaggedLine(ctx, random(seed), px, py, angle, 120, 9, 1.0);
          ctx.stroke();
        }
      });
    }
  }
};

/** The biome's shapes, drawn into a fresh painter from the biome's own random sequence. */
export function drawShapes(kind: Biome): SvgPainter {
  const painter = new SvgPainter(TILE);
  SHAPES[kind](painter, random(hash(kind) || 1));
  return painter;
}
