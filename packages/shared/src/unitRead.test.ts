import { describe, it, expect } from "vitest";
import { aReportUnit, aUnitSilver } from "@atlantis/core-client";
import {
  monthLostToAnUnreadLine,
  NOT_KNOWN,
  silverWasNeverRead,
  unitWasFullyRead,
  unreadBannerText,
  unreadCount,
  unreadLine,
  unreadLineClause,
  weightFloor
} from "./unitRead";
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

describe("the line above a list of units", () => {
  it("counts the rows whose unit was not fully read", () => {
    expect(
      unreadCount([
        aReportUnit({ read: "complete" }),
        aReportUnit({ read: "partial" }),
        aReportUnit({ read: "nothing" })
      ])
    ).toBe(2);
    expect(unreadCount([aReportUnit({ read: "complete" })])).toBe(0);
    expect(unreadCount([])).toBe(0);
  });

  it("warns above a list holding a unit that was not read", () => {
    expect(unreadLine(2, 3)).toBe(
      "\u26a0 2 of these 3 units could not be read. Anything counted here is a floor."
    );
    expect(unreadLine(1, 3)).toBe(
      "\u26a0 1 of these 3 units could not be read. Anything counted here is a floor."
    );
    // A one-unit list would otherwise read "1 of these 1 units", which is not English.
    expect(unreadLine(1, 1)).toBe(
      "\u26a0 1 of these 1 unit could not be read. Anything counted here is a floor."
    );
  });

  it("says nothing above a list that was read", () => {
    expect(unreadLine(0, 3)).toBeNull();
  });
});

describe("the money a broken line cost", () => {
  it("knows when the silver itself was never reached", () => {
    expect(silverWasNeverRead(aUnitSilver({ doubt: "silver-never-read" }))).toBe(true);
    expect(silverWasNeverRead(aUnitSilver({ doubt: "unit-line-cut-short" }))).toBe(false);
    expect(silverWasNeverRead(aUnitSilver({ doubt: "estimated-men" }))).toBe(false);
    expect(silverWasNeverRead(aUnitSilver())).toBe(false);
    expect(silverWasNeverRead(null)).toBe(false);
    expect(silverWasNeverRead(undefined)).toBe(false);
  });

  it("knows when the month cannot be added up, either way round", () => {
    expect(monthLostToAnUnreadLine(aUnitSilver({ doubt: "silver-never-read" }))).toBe(true);
    expect(monthLostToAnUnreadLine(aUnitSilver({ doubt: "unit-line-cut-short" }))).toBe(true);
    expect(monthLostToAnUnreadLine(aUnitSilver({ doubt: "estimated-men" }))).toBe(false);
    expect(monthLostToAnUnreadLine(aUnitSilver())).toBe(false);
    expect(monthLostToAnUnreadLine(null)).toBe(false);
  });

  it("opens the sentence with the whole line or a part of it", () => {
    expect(unreadLineClause(aReportUnit({ read: "nothing" }))).toBe(
      "This unit's line in the turn report"
    );
    expect(unreadLineClause(aReportUnit({ read: "partial" }))).toBe(
      "Part of this unit's line in the turn report"
    );
  });
});

/**
 * `complete` never reaches the clause - the core raises neither doubt for a unit it read whole -
 * but a wrong default here would be a sentence saying something false about a unit that was read.
 */
describe("unreadLineClause's unreachable case", () => {
  it("does not claim part of a completely read unit was lost", () => {
    expect(unreadLineClause(aReportUnit({ read: "complete" }))).toBe(
      "This unit's line in the turn report"
    );
  });
});
