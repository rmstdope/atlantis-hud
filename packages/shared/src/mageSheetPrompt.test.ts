import { describe, expect, it } from "vitest";
import { mageSheetStatus, missingMagesCopy } from "./mageSheetPrompt";
import type { PendingMissingMages } from "./mageSheetImport";
import { aReportUnit, type AlliedMageRecord } from "@atlantis/core-client";

function missingMage(
  unitId: string,
  name: string,
  sheetTurn = 21,
  skills: AlliedMageRecord["unit"]["skills"] = [
    { name: "force", tag: "FORC", level: 3, points: 180 },
    { name: "pattern", tag: "PATT", level: 2, points: 90 },
    { name: "spirit", tag: "SPIR", level: 1, points: 30 }
  ]
): AlliedMageRecord {
  return {
    factionId: "21",
    factionName: "Borg",
    unit: aReportUnit({ unitId, name, own: false, skills }),
    sheetTurn,
    receivedAt: "2026-01-01T00:00:00.000Z"
  };
}

function pending(overrides: Partial<PendingMissingMages> = {}): PendingMissingMages {
  return {
    factionLabel: "Borg (21)",
    sheetTurn: 23,
    taken: 4,
    missing: [missingMage("1204", "Alrik"), missingMage("1301", "Bela")],
    ...overrides
  };
}

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

describe("missingMagesCopy", () => {
  it("names the mages a new sheet leaves out and what keeping them means", () => {
    const copy = missingMagesCopy(pending());

    expect(copy.question).toBe(
      "Borg (21)'s turn 23 sheet leaves out 2 mages that its turn 21 sheet had:"
    );
    expect(copy.mages).toEqual([
      "Alrik (1204) — force 3, pattern 2, spirit 1, last seen turn 21",
      "Bela (1301) — force 3, pattern 2, spirit 1, last seen turn 21"
    ]);
    expect(copy.more).toBeNull();
    expect(copy.explanation).toBe(
      "Discard them if Borg (21) has lost them. Keep them as stale and the study planner still " +
        "shows all 2, marked 2 turns old, with their study since then guessed."
    );
    expect(copy.discardLabel).toBe("Discard them");
    expect(copy.keepLabel).toBe("Keep as stale");
  });

  it("names five and counts the rest", () => {
    const missing = Array.from({ length: 11 }, (_one, index) =>
      missingMage(`${1200 + index}`, `Mage ${index}`)
    );

    const copy = missingMagesCopy(pending({ missing }));

    expect(copy.mages).toHaveLength(5);
    expect(copy.more).toBe("and 6 more");
    expect(copy.explanation).toContain("shows all 11");
  });

  it("names no turn at all when the missing mages came from several sheets", () => {
    const copy = missingMagesCopy(
      pending({ missing: [missingMage("1204", "Alrik", 21), missingMage("1301", "Bela", 19)] })
    );

    expect(copy.question).toBe(
      "Borg (21)'s turn 23 sheet leaves out 2 mages that earlier sheets had:"
    );
    expect(copy.explanation).toContain("marked stale");
    expect(copy.explanation).not.toContain("turns old");
  });

  it("speaks of one missing mage in the singular", () => {
    const copy = missingMagesCopy(
      pending({ sheetTurn: 22, missing: [missingMage("1204", "Alrik")] })
    );

    expect(copy.question).toBe(
      "Borg (21)'s turn 22 sheet leaves out 1 mage that its turn 21 sheet had:"
    );
    expect(copy.explanation).toBe(
      "Discard him if Borg (21) has lost him. Keep him as stale and the study planner still " +
        "shows him, marked 1 turn old, with his study since then guessed."
    );
    expect(copy.discardLabel).toBe("Discard him");
  });

  it("says so when a missing mage carried no skills", () => {
    const copy = missingMagesCopy(pending({ missing: [missingMage("1204", "Alrik", 21, [])] }));

    expect(copy.mages).toEqual(["Alrik (1204) — no skills recorded, last seen turn 21"]);
  });
});
