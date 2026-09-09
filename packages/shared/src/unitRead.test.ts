import { describe, it, expect } from "vitest";
import { aReportUnit } from "@atlantis/core-client";
import { NOT_KNOWN, unitWasFullyRead, unreadBannerText, weightFloor } from "./unitRead";
import type { GameDataEntry, GameDataIndex } from "./gameData";

/** `byId` decides an item tag's category; `detailOf` is what carries the weight. */
const indexWeighing = (weights: Record<string, number>): GameDataIndex => ({
  entries: [],
  byId: new Map(Object.keys(weights).map((id) => [id, { id } as GameDataEntry])),
  detailOf: (id: string) =>
    weights[id] === undefined
      ? null
      : ({ kind: "item", weight: weights[id] } as unknown as ReturnType<
          GameDataIndex["detailOf"]
        >),
  revealedBy: new Map(),
  terrainResources: new Map()
});

describe("unreadBannerText", () => {
  it("says a unit whose line was not read at all was not read", () => {
    expect(unreadBannerText(aReportUnit({ read: "nothing" }))).toBe(
      "This unit was not read. Its line in the turn report was not in a shape Atlantis HUD could " +
        "read, so nothing it holds is known and no advice is given for it."
    );
  });

  it("says a unit whose line was part read was part read", () => {
    expect(unreadBannerText(aReportUnit({ read: "partial" }))).toBe(
      "Part of this unit was not read. Its line in the turn report was not in a shape Atlantis " +
        "HUD could read, so what it holds is not fully known and no advice is given for it."
    );
  });

  it("says nothing about a unit that was read", () => {
    expect(unreadBannerText(aReportUnit({ read: "complete" }))).toBeNull();
    expect(unitWasFullyRead(aReportUnit({ read: "complete" }))).toBe(true);
    expect(unitWasFullyRead(aReportUnit({ read: "partial" }))).toBe(false);
    expect(NOT_KNOWN).toBe("not known");
  });
});

describe("weightFloor", () => {
  const index = indexWeighing({ "mount:HORS": 50 });

  it("floors an unread unit's weight at what was read", () => {
    const twoHorses = aReportUnit({
      read: "partial",
      items: [{ amount: 2, name: "horse", tag: "HORS" }]
    });
    expect(weightFloor(twoHorses, index)).toBe(100);
  });

  it("has no floor without a catalogue, and none from nothing", () => {
    const twoHorses = aReportUnit({
      read: "partial",
      items: [{ amount: 2, name: "horse", tag: "HORS" }]
    });
    expect(weightFloor(twoHorses, null)).toBeNull();
    expect(weightFloor(aReportUnit({ read: "nothing", items: [] }), index)).toBeNull();
  });

  it("skips an item the catalogue does not know rather than throwing", () => {
    const unit = aReportUnit({
      read: "partial",
      items: [
        { amount: 2, name: "horse", tag: "HORS" },
        { amount: 3, name: "widget", tag: "ZZZZ" }
      ]
    });
    expect(weightFloor(unit, index)).toBe(100);
  });
});
