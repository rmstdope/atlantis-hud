import { describe, expect, it } from "vitest";
import type { ShelterSeat } from "@atlantis/core-client";
import { mageShelters, shelterKey, shelterSeats } from "./studyShelter";
import type { PlannerGroup } from "./studyPlanner";

/**
 * The seat rule itself - buildings, ships, fleets, unfinished - is the core's
 * (`crates/core/src/orders/shelter.rs`, ah-29p5) and is tested there. What this module owns is
 * reading the core's answer into the map the planner looks shelters up in.
 */
describe("where a mage can study above level 2", () => {
  const answer: ShelterSeat[] = [
    { regionId: "1:7", structureId: "3", seats: 1 },
    { regionId: "1:7", structureId: "4", seats: 0 },
    { regionId: "2:8", structureId: "3", seats: null }
  ];

  it("keys every structure the core counted by its region and number", () => {
    const seats = shelterSeats(answer);

    expect(seats.get(shelterKey("1:7", "3"))).toBe(1);
    expect(seats.get(shelterKey("1:7", "4"))).toBe(0);
  });

  it("keeps a structure the core could not count as not known, not as none", () => {
    const seats = shelterSeats(answer);

    expect(seats.has(shelterKey("2:8", "3"))).toBe(true);
    expect(seats.get(shelterKey("2:8", "3"))).toBeNull();
  });

  it("has no entry for a structure the core did not answer for", () => {
    expect(shelterSeats(answer).has(shelterKey("9:9", "3"))).toBe(false);
  });

  it("has no entry at all before the core has answered", () => {
    expect(shelterSeats(null).size).toBe(0);
  });
});

// ah-zpq3: the same question `scheduleRows` asks, so a mage who enters a full Fort is told his seat
// is taken rather than that he is standing outside.
describe("mageShelters", () => {
  const groups = [
    {
      factionId: "21",
      factionLabel: "Your faction",
      source: "own",
      heading: "Your faction",
      stale: false,
      mages: [
        {
          key: "21/2431",
          factionId: "21",
          unitId: "2431",
          name: "Kesh",
          regionId: "1:7",
          structureId: null
        }
      ]
    }
  ] as unknown as PlannerGroup[];
  // `1:7/9` is the report's own structure whose kind the catalogue cannot count - `null` is "not
  // known", which is a different fact from a key the map does not hold at all.
  const seats = new Map<string, number | null>([
    ["1:7/4", 1],
    ["1:7/9", null]
  ]);
  const names = new Map([["1:7/4", "Castle"]]);

  it("says nothing about a mage the report found in the open", () => {
    expect(mageShelters({ groups, seats, names, after: new Map() }).size).toBe(0);
  });

  it("names the building this month's orders put him in", () => {
    const shelters = mageShelters({
      groups,
      seats,
      names,
      after: new Map([
        [
          "21/2431",
          {
            regionId: "1:7",
            structureId: "4",
            offMap: false,
            leftBuilding: null,
            leftBy: null
          }
        ]
      ])
    });

    expect(shelters.get("21/2431")).toEqual({ name: "Castle", seats: 1 });
  });

  // A building the report shows but the catalogue cannot count is not a shelter anybody can talk
  // about: `plannerNotices` reads an absent entry as the open, which is what it should say.
  it("says nothing about a building whose seats are not known", () => {
    const shelters = mageShelters({
      groups,
      seats,
      names,
      after: new Map([
        [
          "21/2431",
          {
            regionId: "1:7",
            structureId: "9",
            offMap: false,
            leftBuilding: null,
            leftBy: null
          }
        ]
      ])
    });

    expect(shelters.size).toBe(0);
  });

  it("says nothing about a structure the report never showed", () => {
    const shelters = mageShelters({
      groups,
      seats,
      names,
      after: new Map([
        [
          "21/2431",
          {
            regionId: "1:7",
            structureId: "12",
            offMap: false,
            leftBuilding: null,
            leftBy: null
          }
        ]
      ])
    });

    expect(shelters.size).toBe(0);
  });

  it("says nothing about a mage who ends the month off the map", () => {
    const shelters = mageShelters({
      groups,
      seats,
      names,
      after: new Map([
        [
          "21/2431",
          {
            regionId: "9:9",
            structureId: null,
            offMap: true,
            leftBuilding: null,
            leftBy: null
          }
        ]
      ])
    });

    expect(shelters.size).toBe(0);
  });
});
