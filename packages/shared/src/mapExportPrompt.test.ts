import { describe, expect, it } from "vitest";
import {
  describeAtlaClientAges,
  mapExportPromptParagraphs,
  describeMapExportAdded,
  mapExportPromptCopy
} from "./mapExportPrompt";
import type { AtlaClientAges } from "./atlaClientImport";
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
    atlaClient: null,
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

function ages(overrides: Partial<AtlaClientAges> = {}): AtlaClientAges {
  return {
    fileTurn: 16,
    currentHexes: 49,
    olderHexes: 29,
    oldestTurn: 5,
    undatedHexes: 5,
    ...overrides
  };
}

describe("the AtlaClient age line", () => {
  it("names each of the three clauses when all three apply", () => {
    expect(describeAtlaClientAges(ages())).toBe(
      "49 hexes are as new as turn 16; 29 are older, back to turn 5; " +
        "5 do not say when they were seen and are added as turn 0."
    );
  });

  it("says so in one clause when nothing is older and nothing undated", () => {
    expect(
      describeAtlaClientAges(ages({ currentHexes: 83, olderHexes: 0, oldestTurn: null, undatedHexes: 0 }))
    ).toBe("All 83 hexes are as new as turn 16.");
  });

  it("says so for a single current hex", () => {
    expect(
      describeAtlaClientAges(ages({ currentHexes: 1, olderHexes: 0, oldestTurn: null, undatedHexes: 0 }))
    ).toBe("Its 1 hex is as new as turn 16.");
  });

  it("counts one of each in the singular", () => {
    expect(
      describeAtlaClientAges(ages({ currentHexes: 1, olderHexes: 1, oldestTurn: 9, undatedHexes: 1 }))
    ).toBe(
      "1 hex is as new as turn 16; 1 is older, from turn 9; " +
        "1 does not say when it was seen and is added as turn 0."
    );
  });

  it("leaves out the current clause when nothing is as new as the file", () => {
    expect(
      describeAtlaClientAges(ages({ currentHexes: 0, olderHexes: 4, oldestTurn: 2, undatedHexes: 0 }))
    ).toBe("4 are older, back to turn 2.");
  });

  it("leaves out the older clause when nothing is older", () => {
    expect(
      describeAtlaClientAges(ages({ currentHexes: 7, olderHexes: 0, oldestTurn: null, undatedHexes: 2 }))
    ).toBe("7 hexes are as new as turn 16; 2 do not say when they were seen and are added as turn 0.");
  });
});

describe("mapExportPromptCopy, given a map exported by AtlaClient", () => {
  const fromAtlaClient = pending({
    fileName: "atlaclient-map.16",
    incomingFactionLabel: "AtlaClient",
    incomingTurn: 16,
    totalHexes: 83,
    newHexes: 61,
    atlaClient: ages()
  });

  it("names AtlaClient rather than a faction, and says how old the hexes are", () => {
    expect(mapExportPromptCopy(fromAtlaClient)).toEqual([
      "atlaclient-map.16 is a map exported from AtlaClient on turn 16. " +
        "It holds 83 hexes, 61 of them new to your map.",
      "49 hexes are as new as turn 16; 29 are older, back to turn 5; " +
        "5 do not say when they were seen and are added as turn 0.",
      "Add to map takes every hex your own map does not already know more recently. " +
        "You stay on Borg TNG (95), turn 71, and nothing you have is replaced."
    ]);
  });

  it("still says there is nothing to add when there is not", () => {
    const copy = mapExportPromptCopy(pending({ ...fromAtlaClient, newHexes: 0 }));
    expect(copy).toHaveLength(3);
    expect(copy[2]).toBe("There is nothing in it to add. Adding it anyway changes nothing.");
  });
});

describe("how the prompt's paragraphs are set", () => {
  it("dims nothing for one of our own exports", () => {
    expect(mapExportPromptParagraphs(pending()).map((p) => p.dim)).toEqual([false, false]);
  });

  // Settled with the navigator at Q1: the age line is context for the decision rather than part
  // of it, and the committed mockup sets it dimmer than the two either side.
  it("dims the age line, and only the age line, for an AtlaClient map", () => {
    const paragraphs = mapExportPromptParagraphs(
      pending({ atlaClient: ages(), incomingTurn: 16, totalHexes: 83, newHexes: 61 })
    );

    expect(paragraphs.map((p) => p.dim)).toEqual([false, true, false]);
  });
});
