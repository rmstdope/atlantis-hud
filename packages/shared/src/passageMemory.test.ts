import { describe, expect, it } from "vitest";
import { aParsedReport, aReportRegion, aReportUnit } from "@atlantis/core-client";
import type { Coordinate, PassageClaim } from "@atlantis/core-client";
import {
  knownPassagesOf,
  NO_PASSAGE_MEMORY,
  passageKey,
  withCrossings,
  type PassageMemory
} from "./passageMemory";

const SHAFT_HEX: Coordinate = { x: 1, y: 1, z: 1 };

const aClaim = (over: Partial<PassageClaim> = {}): PassageClaim => ({
  unitId: "5",
  entry: SHAFT_HEX,
  structureId: "1",
  structure: "Shaft [1]",
  ...over
});

/** The unit standing in a cavern on the underworld level: where the passage came out. */
const cameOutIn = (
  coordinate: Coordinate,
  terrain: string,
  unitId = "5",
  own = true
) =>
  aParsedReport({
    regions: [
      aReportRegion({
        coordinate,
        terrain,
        units: [aReportUnit({ unitId, own })]
      })
    ]
  });

const UNDERWORLD: Coordinate = { x: 12, y: 34, z: 2 };

describe("passageMemory (ah-3u7c.2.1)", () => {
  it("learns where a claimed crossing came out", () => {
    const memory = withCrossings(
      NO_PASSAGE_MEMORY,
      [aClaim()],
      cameOutIn(UNDERWORLD, "cavern"),
      56
    );

    expect(knownPassagesOf(memory)).toEqual([
      {
        entry: SHAFT_HEX,
        structureId: "1",
        structure: "Shaft [1]",
        destination: UNDERWORLD,
        destinationTerrain: "cavern",
        learnedInTurn: 56
      }
    ]);
  });

  it("proves nothing when the unit is still standing where it went in", () => {
    const memory = withCrossings(
      NO_PASSAGE_MEMORY,
      [aClaim()],
      cameOutIn(SHAFT_HEX, "plain"),
      56
    );

    expect(knownPassagesOf(memory)).toEqual([]);
  });

  it("proves nothing when the unit is gone from the next turn's report", () => {
    const memory = withCrossings(
      NO_PASSAGE_MEMORY,
      [aClaim()],
      cameOutIn(UNDERWORLD, "cavern", "99"),
      56
    );

    expect(knownPassagesOf(memory)).toEqual([]);
  });

  it("lets a later turn replace an earlier answer, because a number can be reused", () => {
    const first = withCrossings(
      NO_PASSAGE_MEMORY,
      [aClaim()],
      cameOutIn(UNDERWORLD, "cavern"),
      56
    );
    const second = withCrossings(
      first,
      [aClaim()],
      cameOutIn({ x: 20, y: 40, z: 2 }, "tunnels"),
      60
    );

    expect(knownPassagesOf(second)).toEqual([
      expect.objectContaining({
        destination: { x: 20, y: 40, z: 2 },
        destinationTerrain: "tunnels",
        learnedInTurn: 60
      })
    ]);
  });

  it("remembers two structures in one hex apart, because a number is unique only per hex", () => {
    const memory = withCrossings(
      NO_PASSAGE_MEMORY,
      [aClaim(), aClaim({ unitId: "6", structureId: "2", structure: "Shaft [2]" })],
      aParsedReport({
        regions: [
          aReportRegion({
            coordinate: UNDERWORLD,
            terrain: "cavern",
            units: [aReportUnit({ unitId: "5", own: true })]
          }),
          aReportRegion({
            coordinate: { x: 99, y: 99, z: 2 },
            terrain: "tunnels",
            units: [aReportUnit({ unitId: "6", own: true })]
          })
        ]
      }),
      56
    );

    expect(memory.size).toBe(2);
    expect(memory.get(passageKey(SHAFT_HEX, "1"))?.destination).toEqual(UNDERWORLD);
    expect(memory.get(passageKey(SHAFT_HEX, "2"))?.destination).toEqual({
      x: 99,
      y: 99,
      z: 2
    });
  });

  it("ignores a foreign unit standing where ours was claimed to go", () => {
    const memory: PassageMemory = withCrossings(
      NO_PASSAGE_MEMORY,
      [aClaim()],
      cameOutIn(UNDERWORLD, "cavern", "5", false),
      56
    );

    expect(knownPassagesOf(memory)).toEqual([]);
  });
});
