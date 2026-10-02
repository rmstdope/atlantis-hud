import { describe, expect, it } from "vitest";
import { aHexView } from "./hexViewFixture";

describe("aHexView", () => {
  it("is a hex holding nothing a theme would mark", () => {
    const view = aHexView();

    expect(view).toMatchObject({
      texture: null,
      fogOpacity: 0,
      hatched: false,
      unsurveyed: false,
      knowledge: "current",
      roads: [],
      unfinishedRoads: [],
      settlement: null,
      units: { own: 0, foreign: 0, monster: 0 },
      guard: null,
      ships: 0,
      buildings: 0,
      shafts: 0,
      lairs: 0,
      battle: null,
      blocked: null,
      gate: false
    });
  });

  it("replaces only the fields an override names", () => {
    const view = aHexView({ ships: 2, terrain: "plain" });

    expect(view).toEqual({ ...aHexView(), ships: 2, terrain: "plain" });
  });
});
