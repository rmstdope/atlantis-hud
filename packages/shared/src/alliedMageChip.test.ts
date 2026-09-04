import { describe, expect, it } from "vitest";
import type { AlliedMageRecord, ReportUnit } from "@atlantis/core-client";
import {
  forgetConfirmText,
  forgetFailedText,
  forgottenStatusText,
  keysForFaction,
  mageSheetChip,
  mageSheetRows
} from "./alliedMageChip";

function mage(
  factionId: string,
  factionName: string | null,
  unitId: string,
  sheetTurn: number
): AlliedMageRecord {
  return {
    factionId,
    factionName,
    unit: { unitId } as unknown as ReportUnit,
    sheetTurn,
    receivedAt: "2026-09-01T00:00:00.000Z"
  };
}

describe("mageSheetRows", () => {
  it("groups held mages by faction, newest sheet turn each, oldest first", () => {
    const rows = mageSheetRows(
      [
        mage("9", "Nine", "n1", 23),
        mage("17", "Creeping Death", "c1", 21),
        mage("17", "Creeping Death", "c2", 19),
        mage("17", null, "c3", 21),
        mage("10", "Ten", "t1", 23)
      ],
      23
    );

    expect(rows.map((row) => row.factionId)).toEqual(["17", "9", "10"]);
    expect(rows[0]).toMatchObject({
      factionLabel: "Creeping Death (17)",
      mageCount: 3,
      sheetTurn: 21,
      turnsOld: 2,
      countText: "3 mages",
      turnText: "turn 21 · 2 turns old"
    });
    expect(rows[1]).toMatchObject({ mageCount: 1, countText: "1 mage", turnText: "turn 23" });
  });

  it("names a faction that sent no name", () => {
    const [row] = mageSheetRows([mage("17", null, "c1", 23)], 23);
    expect(row.factionLabel).toBe("Faction 17");
  });

  it("says when a sheet is one turn old, or ahead of the viewed turn", () => {
    expect(mageSheetRows([mage("17", null, "c1", 22)], 23)[0].turnText).toBe(
      "turn 22 · 1 turn old"
    );
    expect(mageSheetRows([mage("17", null, "c1", 24)], 23)[0].turnText).toBe(
      "turn 24 · ahead of this turn"
    );
  });

  it("calls nothing old when no report is loaded", () => {
    const [row] = mageSheetRows([mage("17", null, "c1", 22)], null);
    expect(row).toMatchObject({ turnsOld: 0, turnText: "turn 22" });
  });

  it("falls back to a text compare when a faction id is not a number", () => {
    const rows = mageSheetRows([mage("zz", null, "z1", 23), mage("9", null, "n1", 23)], 23);
    expect(rows.map((row) => row.factionId)).toEqual(["9", "zz"]);
  });
});

describe("mageSheetChip", () => {
  it("says nothing when no sheet is held", () => {
    expect(mageSheetChip(mageSheetRows([], 23))).toBeNull();
  });

  it("counts the sheets, and how many are behind the turn", () => {
    expect(mageSheetChip(mageSheetRows([mage("17", null, "c1", 23)], 23))).toEqual({
      text: "1 mage sheet",
      stale: false
    });
    expect(
      mageSheetChip(mageSheetRows([mage("17", null, "c1", 21), mage("9", null, "n1", 23)], 23))
    ).toEqual({ text: "2 mage sheets · 1 old", stale: true });
  });
});

describe("keysForFaction", () => {
  it("takes every one of that faction's rows and nothing else", () => {
    const held = [mage("17", null, "c1", 21), mage("17", null, "c2", 19), mage("9", null, "n1", 23)];
    expect(keysForFaction(held, "17")).toEqual([
      { factionId: "17", unitId: "c1" },
      { factionId: "17", unitId: "c2" }
    ]);
  });
});

describe("the sentences", () => {
  const [row] = mageSheetRows(
    [mage("17", "Creeping Death", "c1", 21), mage("17", "Creeping Death", "c2", 21), mage("17", "Creeping Death", "c3", 21)],
    23
  );

  it("asks before forgetting, and says what happened", () => {
    expect(forgetConfirmText(row)).toBe(
      "Forget Creeping Death (17)'s 3 mages? A newer sheet from them brings them back."
    );
    expect(forgottenStatusText(row)).toBe("3 mages from Creeping Death (17) forgotten");
    expect(forgetFailedText(row)).toBe("could not forget Creeping Death (17)'s mage sheet");
  });
});
