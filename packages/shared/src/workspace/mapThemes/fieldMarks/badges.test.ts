import { describe, expect, it } from "vitest";
import {
  BADGE_KEYS,
  BADGE_SPECS,
  badgeHref,
  housePositions,
  keepOf,
  shieldRow,
  workshopAnchors
} from "./badges";

describe("BADGE_SPECS", () => {
  it("has exactly one entry per declared key, no more and no fewer", () => {
    expect(Object.keys(BADGE_SPECS).sort()).toEqual([...BADGE_KEYS].sort());
  });

  it("gives every badge a distinct filename", () => {
    const files = Object.values(BADGE_SPECS).map((spec) => spec.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("gives every badge a positive size and a non-empty description", () => {
    for (const spec of Object.values(BADGE_SPECS)) {
      expect(spec.size).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });
});

describe("badgeHref", () => {
  it("points into the badges directory", () => {
    expect(badgeHref("monster")).toBe("/badges/monster.svg");
    expect(badgeHref("guard-own")).toBe("/badges/guard-own.svg");
  });
});

describe("keepOf", () => {
  it("is the keep icon, alone, for a city", () => {
    expect(keepOf("city")).toEqual({ key: "settlement-keep", houses: 0 });
  });

  it("is the house icon twice for a town", () => {
    expect(keepOf("town")).toEqual({ key: "settlement-house", houses: 2 });
  });

  it("is the house icon once for a village or an unknown tier", () => {
    expect(keepOf("village")).toEqual({ key: "settlement-house", houses: 1 });
    expect(keepOf(null)).toEqual({ key: "settlement-house", houses: 1 });
  });
});

describe("housePositions", () => {
  it("centres a single house", () => {
    expect(housePositions(1)).toEqual([{ x: 0, y: -4 }]);
  });

  it("stands two houses either side of centre", () => {
    const positions = housePositions(2);
    expect(positions).toHaveLength(2);
    expect(positions[0].x).toBeLessThan(0);
    expect(positions[1].x).toBeGreaterThan(0);
  });
});

describe("shieldRow", () => {
  it("carries only the groups actually present, centred on the anchor", () => {
    const shields = shieldRow({ own: 3, foreign: 0, monster: 0 });
    expect(shields).toEqual([{ group: "own", count: 3, x: 0 }]);
  });

  it("subtracts monsters out of the foreign tally rather than double-counting them", () => {
    const shields = shieldRow({ own: 0, foreign: 5, monster: 2 });
    const foreign = shields.find((shield) => shield.group === "foreign");
    expect(foreign?.count).toBe(3);
  });

  it("spaces every present group evenly around the centre", () => {
    const shields = shieldRow({ own: 1, foreign: 3, monster: 1 });
    expect(shields.map((shield) => shield.x)).toEqual([-14, 0, 14]);
  });
});

describe("workshopAnchors", () => {
  it("draws no roof for no buildings", () => {
    expect(workshopAnchors(0)).toEqual([]);
  });

  it("bands the count into one, two or three roofs", () => {
    expect(workshopAnchors(1)).toHaveLength(1);
    expect(workshopAnchors(3)).toHaveLength(1);
    expect(workshopAnchors(4)).toHaveLength(2);
    expect(workshopAnchors(6)).toHaveLength(2);
    expect(workshopAnchors(7)).toHaveLength(3);
    expect(workshopAnchors(500)).toHaveLength(3);
  });

  it("cascades each roof right and down from the first", () => {
    const anchors = workshopAnchors(7);
    expect(anchors[1].x).toBeGreaterThan(anchors[0].x);
    expect(anchors[1].y).toBeGreaterThan(anchors[0].y);
  });
});
