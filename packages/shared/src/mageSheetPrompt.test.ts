import { describe, expect, it } from "vitest";
import { mageSheetStatus } from "./mageSheetPrompt";

describe("mageSheetStatus", () => {
  const base = { factionLabel: "Borg (21)", turnNumber: 23, taken: 4 };

  it("says what arrived when nothing was left out", () => {
    expect(mageSheetStatus({ ...base, replacedTurn: null, leftovers: { kind: "none" } })).toBe(
      "4 mages from Borg (21), turn 23, taken in"
    );
  });

  it("names the sheet it replaced", () => {
    expect(mageSheetStatus({ ...base, replacedTurn: 21, leftovers: { kind: "none" } })).toBe(
      "4 mages from Borg (21), turn 23, taken in — replacing turn 21"
    );
  });

  it("counts one mage in the singular", () => {
    expect(
      mageSheetStatus({ ...base, taken: 1, replacedTurn: null, leftovers: { kind: "none" } })
    ).toBe("1 mage from Borg (21), turn 23, taken in");
  });

  it("says what became of the mages the sheet left out", () => {
    expect(
      mageSheetStatus({ ...base, replacedTurn: 21, leftovers: { kind: "discarded", count: 2 } })
    ).toBe("4 mages from Borg (21), turn 23, taken in — 2 no longer in the sheet were discarded");
    expect(
      mageSheetStatus({ ...base, replacedTurn: 21, leftovers: { kind: "discarded", count: 1 } })
    ).toBe("4 mages from Borg (21), turn 23, taken in — 1 no longer in the sheet was discarded");
    expect(
      mageSheetStatus({
        ...base,
        replacedTurn: 21,
        leftovers: { kind: "kept", count: 2, fromTurn: 21 }
      })
    ).toBe("4 mages from Borg (21), turn 23, taken in — 2 kept from turn 21, now stale");
    expect(
      mageSheetStatus({
        ...base,
        replacedTurn: 21,
        leftovers: { kind: "kept", count: 3, fromTurn: null }
      })
    ).toBe("4 mages from Borg (21), turn 23, taken in — 3 kept from earlier sheets, now stale");
  });

  it("says an empty sheet was taken in", () => {
    expect(
      mageSheetStatus({ ...base, taken: 0, replacedTurn: null, leftovers: { kind: "none" } })
    ).toBe("Borg (21) had no mages on turn 23 — the sheet is empty, and it was taken in");
  });

  it("drops the empty sheet's own clause when it also left mages out", () => {
    expect(
      mageSheetStatus({
        ...base,
        taken: 0,
        replacedTurn: 21,
        leftovers: { kind: "discarded", count: 2 }
      })
    ).toBe("Borg (21) had no mages on turn 23 — the sheet is empty; 2 no longer in it were discarded");
    expect(
      mageSheetStatus({
        ...base,
        taken: 0,
        replacedTurn: 21,
        leftovers: { kind: "kept", count: 1, fromTurn: 21 }
      })
    ).toBe("Borg (21) had no mages on turn 23 — the sheet is empty; 1 kept from turn 21, now stale");
  });
});
