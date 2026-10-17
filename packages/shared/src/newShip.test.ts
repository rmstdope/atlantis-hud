import { describe, expect, it } from "vitest";
import type { NewShip } from "@atlantis/core-client";
import { monthEndStructureLabel, newShipStructureNote, predictsStructure } from "./newShip";

const ship = (outcome: NewShip["outcome"], name = "Longship"): { newShip: NewShip } => ({
  newShip: { name, tag: "LONG", outcome }
});

describe("monthEndStructureLabel", () => {
  it("names a ship finished into a new fleet as the next report will", () => {
    expect(monthEndStructureLabel(ship("new-fleet"), null)).toBe("Ship [new] · Longship");
    expect(monthEndStructureLabel(ship("new-fleet", "Galleon"), "Tower [4] · Tower")).toBe(
      "Ship [new] · Galleon"
    );
  });

  it("keeps the label of a fleet the ship joins, and of every other row", () => {
    expect(monthEndStructureLabel(ship("joins-fleet"), "Ship [250] · Longship")).toBe(
      "Ship [250] · Longship"
    );
    expect(monthEndStructureLabel(ship("unfinished"), null)).toBeNull();
    expect(monthEndStructureLabel({}, "Tower [4] · Tower")).toBe("Tower [4] · Tower");
  });
});

describe("newShipStructureNote", () => {
  it("says the unit is aboard a new ship", () => {
    expect(newShipStructureNote(ship("new-fleet"))).toBe(
      "Finished this month: a new Longship, with this unit aboard."
    );
  });

  it("says the ship joins the fleet", () => {
    expect(newShipStructureNote(ship("joins-fleet"))).toBe(
      "Finished this month: a new Longship joins this fleet."
    );
  });

  it("says nothing of an unfinished ship, or of a row with none", () => {
    expect(newShipStructureNote(ship("unfinished"))).toBeNull();
    expect(newShipStructureNote({})).toBeNull();
  });
});

describe("predictsStructure", () => {
  it("is true only where the Structure cell reads a month the ship changes", () => {
    expect(predictsStructure(ship("new-fleet"))).toBe(true);
    expect(predictsStructure(ship("joins-fleet"))).toBe(true);
    expect(predictsStructure(ship("unfinished"))).toBe(false);
    expect(predictsStructure({})).toBe(false);
  });
});
