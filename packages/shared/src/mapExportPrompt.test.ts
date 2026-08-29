import { describe, expect, it } from "vitest";
import { describeMapExportAdded, mapExportPromptCopy } from "./mapExportPrompt";
import type { PendingMapExport } from "./reportLoad";
import { aParsedReport } from "@atlantis/core-client";

function pending(overrides: Partial<PendingMapExport> = {}): PendingMapExport {
  return {
    report: aParsedReport(),
    text: "",
    fileName: "map-turn-40-level-1.txt",
    ownFaction: false,
    incomingFactionLabel: "The Disinherited Knights (42)",
    incomingTurn: 40,
    totalHexes: 12,
    newHexes: 3,
    level: 1,
    viewer: { factionId: "95", factionLabel: "Borg TNG (95)", turnNumber: 71 },
    ...overrides
  };
}

describe("mapExportPromptCopy", () => {
  it("names an ally's file, its faction and its turn", () => {
    expect(mapExportPromptCopy(pending())[0]).toBe(
      "map-turn-40-level-1.txt is a map export from The Disinherited Knights (42), written on turn 40. " +
        "It holds 12 hexes, 3 of them new to your map."
    );
  });

  it("says so when the file is your own faction's", () => {
    expect(mapExportPromptCopy(pending({ ownFaction: true, incomingFactionLabel: "Borg TNG (95)" }))[0]).toBe(
      "map-turn-40-level-1.txt is a map export from your own faction, Borg TNG (95), written on turn 40. " +
        "It holds 12 hexes, 3 of them new to your map."
    );
  });

  it("counts one hex that is new", () => {
    expect(mapExportPromptCopy(pending({ totalHexes: 1, newHexes: 1 }))[0]).toContain(
      "It holds 1 hex, and it is new to your map."
    );
  });

  it("counts one hex you already have", () => {
    expect(mapExportPromptCopy(pending({ totalHexes: 1, newHexes: 0 }))[0]).toContain(
      "It holds 1 hex, and your map already has it."
    );
  });

  it("counts many hexes, none of them new", () => {
    expect(mapExportPromptCopy(pending({ totalHexes: 12, newHexes: 0 }))[0]).toContain(
      "It holds 12 hexes, none of them new to your map."
    );
  });

  it("counts many hexes, one of them new", () => {
    expect(mapExportPromptCopy(pending({ totalHexes: 12, newHexes: 1 }))[0]).toContain(
      "It holds 12 hexes, 1 of them new to your map."
    );
  });

  it("promises the turn on screen survives, when there is something to add", () => {
    expect(mapExportPromptCopy(pending())[1]).toBe(
      "Add to map takes every hex your own map does not already know more recently. " +
        "You stay on Borg TNG (95), turn 71, and nothing you have is replaced."
    );
  });

  it("says plainly when there is nothing in it to add", () => {
    expect(mapExportPromptCopy(pending({ newHexes: 0 }))[1]).toBe(
      "There is nothing in it to add. Adding it anyway changes nothing."
    );
  });

  it("is two paragraphs, whichever way it reads", () => {
    expect(mapExportPromptCopy(pending())).toHaveLength(2);
    expect(mapExportPromptCopy(pending({ newHexes: 0 }))).toHaveLength(2);
  });
});

describe("describeMapExportAdded", () => {
  it("says nothing landed when nothing did", () => {
    expect(describeMapExportAdded(0, "")).toBe("nothing added — your map already had all of it");
  });

  it("counts one hex", () => {
    expect(describeMapExportAdded(1, "")).toBe("1 hex added to your map");
  });

  it("counts many hexes", () => {
    expect(describeMapExportAdded(8, "")).toBe("8 hexes added to your map");
  });

  /** Otherwise the status reports success while the map in front of the player is identical. */
  it("names the level when the hexes landed off the surface", () => {
    expect(describeMapExportAdded(8, "in the underworld")).toBe(
      "8 hexes added to your map in the underworld"
    );
    expect(describeMapExportAdded(1, "on level 5")).toBe("1 hex added to your map on level 5");
  });

  it("names no level when nothing landed", () => {
    expect(describeMapExportAdded(0, "in the underworld")).toBe(
      "nothing added — your map already had all of it"
    );
  });
});
