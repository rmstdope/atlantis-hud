import { describe, expect, it } from "vitest";
import type { Coordinate } from "@atlantis/core-client";
import type { HexKnowledge, HexNode } from "../hexMapModel";
import { COLUMN_PITCH, ROW_PITCH } from "./mapViewport";
import {
  fogPatternTile,
  hexEdgeMotif,
  hexLayers,
  hexPaint,
  hexPointsAttribute,
  routePoints,
  routeSegments,
  staleFadeAmount,
  terrainTexturePatternId,
  terrainTextureUrl,
  terrainFillClass,
  type Point
} from "./mapHexView";

function at(x: number, y: number, z = 1): Coordinate {
  return { x, y, z };
}

function hex(overrides: Partial<HexNode> & { knowledge: HexKnowledge }): HexNode {
  return {
    regionId: "1:7,53",
    coordinate: at(7, 53),
    terrain: "mountain",
    province: "Inhead",
    label: "mountain (7,53) in Inhead",
    lastSeenTurn: 71,
    ageInTurns: 0,
    settlementName: null,
    region: null,
    ownUnitCount: 0,
    foreignUnitCount: 0,
    ...overrides
  };
}

describe("terrain colour", () => {
  it("names a class for every terrain the renderer knows", () => {
    // Written out in full rather than built from a template: Tailwind only generates a utility it
    // has literally seen in a source file.
    expect(terrainFillClass("ocean")).toBe("fill-terrain-ocean");
    expect(terrainFillClass("wasteland")).toBe("fill-terrain-wasteland");
    expect(terrainFillClass("underforest")).toBe("fill-terrain-underforest");
    expect(terrainFillClass("volcano")).toBe("fill-terrain-volcano");
  });

  it("reads the terrain whatever case the report wrote it in", () => {
    expect(terrainFillClass("Mountain")).toBe("fill-terrain-mountain");
  });

  it("falls back rather than vanishing on a terrain it has never seen", () => {
    // The parser takes whatever word the ruleset uses, so this list can never be exhaustive.
    expect(terrainFillClass("nexus")).toBe("fill-terrain-other");
    expect(terrainFillClass("")).toBe("fill-terrain-other");
  });
});

describe("terrain texture", () => {
  it("maps every generated biome to a public texture asset", () => {
    expect(terrainTextureUrl("ocean")).toBe("/biomes/ocean_512.png");
    expect(terrainTextureUrl("cavern")).toBe("/biomes/cavern_512.png");
    expect(terrainTextureUrl("underforest")).toBe("/biomes/underforest_512.png");
    expect(terrainTextureUrl("wasteland")).toBe("/biomes/wasteland_512.png");
    expect(terrainTexturePatternId("wasteland")).toBe("biome-texture-wasteland");
  });

  it("reads texture names case-insensitively", () => {
    expect(terrainTextureUrl("Mountain")).toBe("/biomes/mountain_512.png");
  });

  it("keeps fallback and unexplored states solid", () => {
    expect(terrainTextureUrl("nexus")).toBeNull();
    expect(terrainTextureUrl("unknown")).toBeNull();
    expect(terrainTexturePatternId("unknown")).toBeNull();
  });
});

describe("how age is drawn", () => {
  it("fades further the longer ago a hex was seen", () => {
    expect(staleFadeAmount(0)).toBeCloseTo(0.3);
    expect(staleFadeAmount(1)).toBeCloseTo(0.32);
    expect(staleFadeAmount(10)).toBeCloseTo(0.5);
  });

  it("stops fading before a hex becomes indistinguishable from unexplored ground", () => {
    // A twenty-turn-old sighting is nearly a rumour, but it is not nothing.
    expect(staleFadeAmount(16)).toBeCloseTo(0.62);
    expect(staleFadeAmount(40)).toBeCloseTo(0.62);
    expect(staleFadeAmount(400)).toBeCloseTo(0.62);
  });

  it("treats an unknown age as the freshest a stale hex can be", () => {
    expect(staleFadeAmount(null)).toBeCloseTo(0.3);
  });
});

describe("painting a hex", () => {
  it("paints a hex from this turn's report at full strength", () => {
    const paint = hexPaint(hex({ knowledge: "current" }), true);

    expect(paint.fogOpacity).toBe(0);
    expect(paint.hatched).toBe(false);
  });

  /**
   * Drained, but never to the point of hiding what the hex is made of.
   *
   * The fade used to be heavy enough (0.78) that a named forest and a named desert were the same
   * pale smudge: the report gives terrain, and the map was throwing it away. It is a fade, not a
   * lid - what makes the hex read as unsurveyed is the rim each theme draws over it, which is
   * structural and survives the far zoom band where labels do not.
   */
  it("drains a hex known only from a neighbour's exits without hiding its terrain", () => {
    const paint = hexPaint(hex({ knowledge: "named" }), true);

    // A range, not just "non-zero": a fade of 0.02 would satisfy a lower bound of zero while
    // leaving unsurveyed ground indistinguishable from ground the player has actually walked.
    expect(paint.fogOpacity).toBeGreaterThan(0.25);
    expect(paint.fogOpacity).toBeLessThan(0.5);
    // Never hatched: hatching is about age, and a hex nobody visited has none.
    expect(paint.hatched).toBe(false);
  });

  /**
   * The wash no longer carries the named/stale distinction, and deliberately so.
   *
   * A named hex is now *lighter* than a long-stale one, which inverts what the fade used to say.
   * That is the trade this made: legible terrain everywhere, and the distinction moved onto the
   * unsurveyed rim and the staleness hatch, which say it in a way a shade of grey never did.
   * Pinned rather than left implicit, because it reads like a bug to anyone who meets it cold.
   */
  it("no longer leans on the fade to tell unvisited ground from an old sighting", () => {
    const named = hexPaint(hex({ knowledge: "named" }), true).fogOpacity;

    expect(named).toBeLessThan(staleFadeAmount(1000));
    // What tells them apart instead, at the view-model level: only one of the two is hatched.
    expect(hexPaint(hex({ knowledge: "named" }), true).hatched).toBe(false);
    expect(hexPaint(hex({ knowledge: "stale", ageInTurns: 40 }), true).hatched).toBe(true);
  });

  it("fades and hatches a hex held over from an earlier turn", () => {
    const paint = hexPaint(hex({ knowledge: "stale", ageInTurns: 7 }), true);

    expect(paint.fogOpacity).toBeCloseTo(0.44);
    // The hatch is what separates "old data" from "dim terrain" at a glance.
    expect(paint.hatched).toBe(true);
  });

  it("drops both the fade and the hatch when the staleness layer is off", () => {
    const paint = hexPaint(hex({ knowledge: "stale", ageInTurns: 7 }), false);

    // Turning the layer off is asking to read terrain without caring about age; a half-off
    // treatment would answer neither question.
    expect(paint.fogOpacity).toBe(0);
    expect(paint.hatched).toBe(false);
  });

  it("keeps a named hex faded even when the staleness layer is off", () => {
    // Staleness is about age. A named hex has no age: it was never visited at all, so the toggle
    // has nothing to say about it either way.
    const off = hexPaint(hex({ knowledge: "named" }), false);

    expect(off.fogOpacity).toBeGreaterThan(0.25);
    expect(off.fogOpacity).toBe(hexPaint(hex({ knowledge: "named" }), true).fogOpacity);
  });
});

describe("hex geometry", () => {
  it("traces a hexagon with a vertex due east, not due north", () => {
    const points = hexPointsAttribute(10)
      .split(" ")
      .map((pair) => pair.split(",").map(Number));

    expect(points).toHaveLength(6);
    expect(points[0][0]).toBeCloseTo(10);
    expect(points[0][1]).toBeCloseTo(0);
    // A pointy-top hexagon would have a corner directly above the centre; a flat-top one does not.
    expect(points.some(([x]) => Math.abs(x) < 0.001)).toBe(false);
  });
});

describe("the unexplored lattice", () => {
  const RADIUS = 18;

  it("repeats over a tile three radii wide and one hex tall", () => {
    const tile = fogPatternTile(RADIUS);

    // Verified against the lattice: (x+2, y+2) is the shortest purely horizontal repeat, and the
    // tile holds exactly two hex centres.
    expect(tile.width).toBeCloseTo(3 * RADIUS);
    expect(tile.height).toBeCloseTo(RADIUS * Math.sqrt(3));
  });

  it("draws every edge of the lattice exactly once", () => {
    // Each hex owns three of its six edges; the other three belong to its northern and western
    // neighbours. Drawing all six would double every line and make the grid twice as heavy.
    const drawn = new Map<string, number>();
    const all = new Map<string, number>();

    for (let x = -6; x <= 6; x += 1) {
      for (let y = -8; y <= 8; y += 1) {
        if ((x + y) % 2 !== 0) {
          continue;
        }
        const centre = { x: COLUMN_PITCH * x, y: ROW_PITCH * y };
        for (const edge of allEdges(centre, RADIUS)) {
          all.set(edgeKey(edge), (all.get(edgeKey(edge)) ?? 0) + 1);
        }
        for (const edge of hexEdgeMotif(RADIUS)) {
          const moved = edge.map((point) => ({ x: point.x + centre.x, y: point.y + centre.y }));
          drawn.set(edgeKey(moved), (drawn.get(edgeKey(moved)) ?? 0) + 1);
        }
      }
    }

    let interior = 0;
    for (const [key, shared] of all) {
      // Only edges between two hexes that are both inside the patch; the rim is an artefact.
      if (shared !== 2) {
        continue;
      }
      interior += 1;
      expect(drawn.get(key) ?? 0).toBe(1);
    }
    expect(interior).toBeGreaterThan(200);
  });

  it("draws the copies that straddle the tile edge, because a pattern clips rather than wraps", () => {
    const tile = fogPatternTile(RADIUS);
    const subpaths = tile.d.trim().split(/(?=M)/).filter(Boolean);

    // One motif is not enough: the shapes overflow the tile, and SVG does not wrap the spill
    // round to the other side.
    expect(subpaths.length).toBeGreaterThan(1);

    // Every lattice edge crossing the tile must be produced by one of them.
    const produced = new Set<string>();
    for (const subpath of subpaths) {
      const numbers = subpath.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      for (let index = 0; index + 3 < numbers.length; index += 2) {
        produced.add(
          edgeKey([
            { x: numbers[index], y: numbers[index + 1] },
            { x: numbers[index + 2], y: numbers[index + 3] }
          ])
        );
      }
    }

    let needed = 0;
    for (let x = -4; x <= 6; x += 1) {
      for (let y = -6; y <= 8; y += 1) {
        if ((x + y) % 2 !== 0) {
          continue;
        }
        const centre = { x: COLUMN_PITCH * x, y: ROW_PITCH * y };
        for (const edge of hexEdgeMotif(RADIUS)) {
          const moved = edge.map((point) => ({ x: point.x + centre.x, y: point.y + centre.y }));
          if (!touchesTile(moved, tile.width, tile.height)) {
            continue;
          }
          needed += 1;
          expect(produced.has(edgeKey(moved))).toBe(true);
        }
      }
    }
    expect(needed).toBeGreaterThan(0);
  });
});

describe("layering the map", () => {
  const hexes = [
    hex({ regionId: "a", knowledge: "named" }),
    hex({ regionId: "b", knowledge: "current" }),
    hex({ regionId: "c", knowledge: "stale" }),
    hex({ regionId: "d", knowledge: "current" }),
    hex({ regionId: "e", knowledge: "current", coordinate: at(7, 53, 2) })
  ];

  it("paints what is known least first, so better knowledge is never buried", () => {
    const layers = hexLayers(hexes, 1);

    expect(layers.named.map((node) => node.regionId)).toEqual(["a"]);
    expect(layers.stale.map((node) => node.regionId)).toEqual(["c"]);
    expect(layers.current.map((node) => node.regionId)).toEqual(["b", "d"]);
  });

  it("leaves out the levels the player is not looking at", () => {
    expect(hexLayers(hexes, 1).current.some((node) => node.regionId === "e")).toBe(false);
    expect(hexLayers(hexes, 2).current.map((node) => node.regionId)).toEqual(["e"]);
  });
});

describe("the planned route", () => {
  it("runs a line through the centre of each hex in turn", () => {
    const points = routePoints([at(7, 53), at(8, 52), at(9, 51)], 1);
    const pairs = points.trim().split(" ");

    expect(pairs).toHaveLength(3);
    const [x, y] = pairs[0].split(",").map(Number);
    expect(x).toBeCloseTo(7 * COLUMN_PITCH);
    expect(y).toBeCloseTo(53 * ROW_PITCH);
  });

  it("leaves out steps on another level, which are not on this map", () => {
    const points = routePoints([at(7, 53), at(8, 52, 2), at(9, 51)], 1);
    expect(points.trim().split(" ")).toHaveLength(2);
  });

  it("draws nothing when there is no route", () => {
    expect(routePoints([], 1)).toBe("");
  });
});

describe("a route split into what happens next turn and what comes later", () => {
  const pairs = (points: string) => (points === "" ? [] : points.trim().split(" "));

  it("puts the first month's steps in the solid line and the rest in the dotted one", () => {
    // Origin plus three steps, of which the first month covers one.
    const segments = routeSegments([at(7, 53), at(7, 51), at(7, 49), at(7, 47)], 1, 1);

    expect(pairs(segments.solid)).toHaveLength(2);
    expect(pairs(segments.dotted)).toHaveLength(3);
    // The dotted line begins where the solid one ends, so the two join seamlessly.
    expect(pairs(segments.dotted)[0]).toBe(pairs(segments.solid)[1]);
  });

  it("starts the solid line at the unit's own hex", () => {
    const segments = routeSegments([at(7, 53), at(7, 51)], 1, 1);
    const [x, y] = pairs(segments.solid)[0].split(",").map(Number);

    expect(x).toBeCloseTo(7 * COLUMN_PITCH);
    expect(y).toBeCloseTo(53 * ROW_PITCH);
    expect(segments.dotted).toBe("");
  });

  it("draws everything dotted when the unit's speed is unknown", () => {
    const segments = routeSegments([at(7, 53), at(7, 51), at(7, 49)], null, 1);

    expect(segments.solid).toBe("");
    expect(pairs(segments.dotted)).toHaveLength(3);
  });

  it("draws everything dotted when the first month is spent saving points", () => {
    // A first hex dearer than a month's allowance means zero steps next turn - legitimate, and
    // the whole path is later-turn work.
    const segments = routeSegments([at(7, 53), at(7, 51)], 0, 1);

    expect(segments.solid).toBe("");
    expect(pairs(segments.dotted)).toHaveLength(2);
  });

  it("draws no lone points, which a polyline cannot show", () => {
    expect(routeSegments([at(7, 53)], 1, 1)).toEqual({ solid: "", dotted: "" });
    expect(routeSegments([], null, 1)).toEqual({ solid: "", dotted: "" });
  });

  it("leaves out steps on another level, exactly as the flat route does", () => {
    const segments = routeSegments([at(7, 53), at(8, 52, 2), at(9, 51)], 2, 1);
    expect(pairs(segments.solid)).toHaveLength(2);
  });
});

/** All six edges of a hex, for the coverage check above. */
function allEdges(centre: Point, radius: number): Point[][] {
  const vertices = Array.from({ length: 6 }, (_, corner) => {
    const angle = (Math.PI / 180) * (60 * corner);
    return { x: centre.x + radius * Math.cos(angle), y: centre.y + radius * Math.sin(angle) };
  });
  return vertices.map((vertex, index) => [vertex, vertices[(index + 1) % 6]]);
}

/** An edge identified independently of which end it was drawn from. */
function edgeKey(edge: Point[]): string {
  return edge
    .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
    .sort()
    .join("|");
}

function touchesTile(edge: Point[], width: number, height: number): boolean {
  const xs = edge.map((point) => point.x);
  const ys = edge.map((point) => point.y);
  return (
    Math.max(...xs) >= 0 &&
    Math.min(...xs) <= width &&
    Math.max(...ys) >= 0 &&
    Math.min(...ys) <= height
  );
}
