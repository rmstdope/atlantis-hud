import { aParsedReport, aReportRegion } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";

import { parseGameData, type GameDataIndex } from "./gameData";
import {
  mergedRecruitSightings,
  NO_RECRUIT_SIGHTINGS,
  racesSeenIn,
  withRecruitTurn
} from "./recruitSightings";

const NO_CAPACITY = { walk: 0, ride: 0, fly: 0, swim: 0 };
const NO_MOBILITY = { walk: false, ride: false, fly: false, swim: false };
const item = (tag: string, name: string, kind: string) => ({
  tag,
  name,
  kind,
  weight: 10,
  capacity: NO_CAPACITY,
  selfMobile: NO_MOBILITY,
  moves: 0
});

const index = parseGameData(
  JSON.stringify({
    skills: {},
    items: {
      HDWA: item("HDWA", "hill dwarves", "man"),
      LEAD: item("LEAD", "leaders", "man"),
      ORC: item("ORC", "orcs", "man"),
      GRAI: item("GRAI", "grain", "equipment")
    }
  })
) as GameDataIndex;

const sale = (tag: string, name: string) => ({ amount: 10, name, tag, price: 50 });

/** A region at `x`, of `terrain`, offering `forSale`. */
const region = (x: number, terrain: string, forSale: ReturnType<typeof sale>[]) =>
  aReportRegion({ coordinate: { x, y: 0, z: 1 }, terrain, forSale });

const turn = (...regions: ReturnType<typeof region>[]) => aParsedReport({ regions });

describe("recruit sightings (ah-yu3j.1)", () => {
  it("counts each race offered for sale by the regions of a terrain", () => {
    const seen = withRecruitTurn(
      NO_RECRUIT_SIGHTINGS,
      turn(
        region(0, "mountain", [sale("HDWA", "hill dwarves"), sale("LEAD", "leaders")]),
        region(2, "mountain", [sale("HDWA", "hill dwarves"), sale("GRAI", "grain")]),
        region(4, "forest", [sale("ORC", "orcs")])
      ),
      index
    );

    expect(racesSeenIn(seen, "mountain", index)).toEqual([
      { id: "man:HDWA", name: "hill dwarves", regions: 2 },
      { id: "man:LEAD", name: "leaders", regions: 1 }
    ]);
  });

  it("ignores anything for sale that is not a race", () => {
    const seen = withRecruitTurn(
      NO_RECRUIT_SIGHTINGS,
      turn(region(0, "mountain", [sale("GRAI", "grain")])),
      index
    );
    expect(racesSeenIn(seen, "mountain", index)).toEqual([]);
  });

  it("counts a region once however many turns saw it, and keeps a race only an earlier turn saw", () => {
    let seen = withRecruitTurn(
      NO_RECRUIT_SIGHTINGS,
      turn(region(0, "mountain", [sale("ORC", "orcs")])),
      index
    );
    seen = withRecruitTurn(seen, turn(region(0, "mountain", [sale("HDWA", "hill dwarves")])), index);
    seen = withRecruitTurn(seen, turn(region(0, "mountain", [sale("HDWA", "hill dwarves")])), index);

    expect(racesSeenIn(seen, "mountain", index)).toEqual([
      { id: "man:HDWA", name: "hill dwarves", regions: 1 },
      { id: "man:ORC", name: "orcs", regions: 1 }
    ]);
  });

  it("orders most regions first, then by name", () => {
    const seen = withRecruitTurn(
      NO_RECRUIT_SIGHTINGS,
      turn(
        region(0, "mountain", [sale("ORC", "orcs"), sale("LEAD", "leaders")]),
        region(2, "mountain", [sale("ORC", "orcs")]),
        region(4, "mountain", [sale("HDWA", "hill dwarves")])
      ),
      index
    );
    expect(racesSeenIn(seen, "mountain", index).map((race) => race.name)).toEqual([
      "orcs",
      "hill dwarves",
      "leaders"
    ]);
  });

  it("matches the terrain whatever its case", () => {
    const seen = withRecruitTurn(
      NO_RECRUIT_SIGHTINGS,
      turn(region(0, "Mountain", [sale("ORC", "orcs")])),
      index
    );
    expect(racesSeenIn(seen, "mountain", index)).toHaveLength(1);
  });

  it("remembers nothing without a catalogue", () => {
    const seen = withRecruitTurn(
      NO_RECRUIT_SIGHTINGS,
      turn(region(0, "mountain", [sale("ORC", "orcs")])),
      null
    );
    expect(seen).toBe(NO_RECRUIT_SIGHTINGS);
  });

  it("merges two sightings as a union, never writing to either", () => {
    const a = withRecruitTurn(NO_RECRUIT_SIGHTINGS, turn(region(0, "mountain", [sale("ORC", "orcs")])), index);
    const b = withRecruitTurn(
      NO_RECRUIT_SIGHTINGS,
      turn(region(0, "mountain", [sale("LEAD", "leaders")]), region(2, "mountain", [sale("ORC", "orcs")])),
      index
    );

    const merged = mergedRecruitSightings(a, b);

    expect(racesSeenIn(merged, "mountain", index)).toEqual([
      { id: "man:ORC", name: "orcs", regions: 2 },
      { id: "man:LEAD", name: "leaders", regions: 1 }
    ]);
    expect(racesSeenIn(a, "mountain", index)).toEqual([{ id: "man:ORC", name: "orcs", regions: 1 }]);
  });
});
