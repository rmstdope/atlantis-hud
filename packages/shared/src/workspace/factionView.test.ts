import { describe, expect, it } from "vitest";
import type { DeclaredAttitudes, FactionStatus } from "@atlantis/core-client";
import { allowanceRows, attitudeLines } from "./factionView";

describe("allowanceRows", () => {
  it("reports used, maximum and the fraction for each entry, in the order the report printed them", () => {
    const status: FactionStatus = {
      entries: [
        { label: "Regions", used: 3, maximum: 10 },
        { label: "Mages", used: 6, maximum: 6 }
      ],
      unparsed: []
    };

    expect(allowanceRows(status)).toEqual([
      { label: "Regions", used: 3, maximum: 10, fraction: 0.3, atCeiling: false },
      { label: "Mages", used: 6, maximum: 6, fraction: 1, atCeiling: true }
    ]);
  });

  it("a full allowance is at its ceiling", () => {
    const status: FactionStatus = { entries: [{ label: "Mages", used: 6, maximum: 6 }], unparsed: [] };

    expect(allowanceRows(status)[0].atCeiling).toBe(true);
  });

  it("an allowance of zero out of zero is not at its ceiling and has no fraction", () => {
    const status: FactionStatus = { entries: [{ label: "Regions", used: 0, maximum: 0 }], unparsed: [] };

    const [row] = allowanceRows(status);
    expect(row.atCeiling).toBe(false);
    expect(row.fraction).toBe(0);
  });

  it("a status with no entries yields no rows", () => {
    const status: FactionStatus = { entries: [], unparsed: [] };

    expect(allowanceRows(status)).toEqual([]);
  });
});

describe("attitudeLines", () => {
  const attitudes: DeclaredAttitudes = {
    defaultAttitude: "Unfriendly",
    levels: [
      { attitude: "Hostile", factions: [{ name: "Creatures", id: "2" }] },
      { attitude: "Unfriendly", factions: [] },
      { attitude: "Neutral", factions: [{ name: "Fon", id: "8" }] }
    ]
  };

  it("one line per level, in the order the report printed them", () => {
    const lines = attitudeLines(attitudes, new Set());

    expect(lines.map((line) => line.attitude)).toEqual(["Hostile", "Unfriendly", "Neutral"]);
  });

  it("a level the report printed as none. is kept, with no factions", () => {
    const lines = attitudeLines(attitudes, new Set());

    const unfriendly = lines.find((line) => line.attitude === "Unfriendly");
    expect(unfriendly?.factions).toEqual([]);
  });

  it("a faction whose report has been merged in is marked, and one that has not is not", () => {
    const lines = attitudeLines(attitudes, new Set(["2"]));

    const hostile = lines.find((line) => line.attitude === "Hostile");
    const neutral = lines.find((line) => line.attitude === "Neutral");
    expect(hostile?.factions).toEqual([{ name: "Creatures", id: "2", merged: true }]);
    expect(neutral?.factions).toEqual([{ name: "Fon", id: "8", merged: false }]);
  });

  it("matching is by faction id, not by name", () => {
    const lines = attitudeLines(attitudes, new Set(["8"]));

    const hostile = lines.find((line) => line.attitude === "Hostile");
    expect(hostile?.factions).toEqual([{ name: "Creatures", id: "2", merged: false }]);
  });
});
