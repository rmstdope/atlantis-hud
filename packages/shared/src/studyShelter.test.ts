import { describe, expect, it } from "vitest";
import { readRuleset } from "@atlantis/fixtures";
import type { ParsedReport } from "@atlantis/core-client";
import { parseGameData, type GameDataIndex } from "./gameData";
import { shelterKey, shelterSeats } from "./studyShelter";

const index = parseGameData(readRuleset()) as GameDataIndex;

/** A report holding one region and whatever structures the case needs. */
function reportWith(
  regionId: string,
  structures: { structureId: string; baseKind: string; needs?: number | null }[]
): ParsedReport {
  return {
    regions: [
      {
        regionId,
        structures: structures.map((structure) => ({
          structureId: structure.structureId,
          name: structure.baseKind,
          kind: structure.baseKind,
          baseKind: structure.baseKind,
          qualifiers: [],
          vessels: [],
          description: null,
          needs: structure.needs ?? null
        })),
        units: []
      }
    ]
  } as unknown as ParsedReport;
}

describe("where a mage can study above level 2", () => {
  // `data/objects` for a Fort: the committed ruleset carries its seat count as `buildings.FORT.mages`.
  it("seats one mage in a Fort", () => {
    const seats = shelterSeats({ report: reportWith("1:7", [{ structureId: "3", baseKind: "Fort" }]), index });

    expect(seats.get(shelterKey("1:7", "3"))).toBe(1);
  });

  // `rules/buildings` is silent, and the Rust core takes the same line (`semantics.rs:9607-9645`).
  it("seats nobody in an unfinished building", () => {
    const seats = shelterSeats({
      report: reportWith("1:7", [{ structureId: "3", baseKind: "Fort", needs: 40 }]),
      index
    });

    expect(seats.get(shelterKey("1:7", "3"))).toBe(0);
  });

  // `rules/magic_skills` speaks of buildings throughout; a ship is not one.
  it("seats nobody in a ship", () => {
    const seats = shelterSeats({ report: reportWith("1:7", [{ structureId: "4", baseKind: "Galleon" }]), index });

    expect(seats.get(shelterKey("1:7", "4"))).toBe(0);
  });

  it("says nothing about a kind the catalogue does not know", () => {
    const seats = shelterSeats({
      report: reportWith("1:7", [{ structureId: "5", baseKind: "Whimsy Pavilion" }]),
      index
    });

    expect(seats.get(shelterKey("1:7", "5"))).toBeNull();
  });

  it("has no entry for a region outside the report", () => {
    const seats = shelterSeats({ report: reportWith("1:7", []), index });

    expect(seats.has(shelterKey("9:9", "3"))).toBe(false);
  });

  it("has no entry at all when there is no report or no catalogue", () => {
    expect(shelterSeats({ report: null, index }).size).toBe(0);
    expect(shelterSeats({ report: reportWith("1:7", [{ structureId: "3", baseKind: "Fort" }]), index: null }).size).toBe(
      0
    );
  });
});
