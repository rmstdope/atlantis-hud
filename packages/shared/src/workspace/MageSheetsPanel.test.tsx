import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { mageSheetRows } from "../alliedMageChip";
import type { AlliedMageRecord, ReportUnit } from "@atlantis/core-client";
import { MageSheetsPanel } from "./MageSheetsPanel";

function mage(factionId: string, factionName: string | null, unitId: string, sheetTurn: number): AlliedMageRecord {
  return {
    factionId,
    factionName,
    unit: { unitId } as unknown as ReportUnit,
    sheetTurn,
    receivedAt: "2026-09-01T00:00:00.000Z"
  };
}

const rows = mageSheetRows(
  [mage("17", "Creeping Death", "c1", 21), mage("17", "Creeping Death", "c2", 21), mage("9", "Nine", "n1", 23)],
  23
);

function draw(armedFactionId: string | null) {
  return renderToStaticMarkup(
    <MageSheetsPanel
      rows={rows}
      armedFactionId={armedFactionId}
      onArm={() => {}}
      onCancel={() => {}}
      onForget={() => {}}
      onDismiss={() => {}}
    />
  );
}

describe("MageSheetsPanel", () => {
  it("draws a row per sheet, and the confirm in the foot when a row is armed", () => {
    const plain = draw(null);
    expect(plain).toContain("mage-sheet-17");
    expect(plain).toContain("mage-sheet-9");
    expect(plain).toContain("Creeping Death (17)");
    expect(plain).toContain("2 mages");
    expect(plain).toContain("turn 21 · 2 turns old");
    expect(plain).toContain("A newer sheet from the same faction replaces the one you hold.");
    expect(plain).toContain("max-h-[calc(100vh-6rem)]");
    expect(plain).not.toContain("forget-mage-sheet-confirm-17");

    const armed = draw("17");
    expect(armed).toContain("forget-mage-sheet-confirm-17");
    expect(armed).toContain(
      "Forget Creeping Death (17)&#x27;s 2 mages? A newer sheet from them brings them back."
    );
    expect(armed).toContain("forget-mage-sheet-do-17");
    expect(armed).toContain(">Cancel<");
    expect(armed).not.toContain("A newer sheet from the same faction replaces the one you hold.");
  });

  it("marks a sheet behind the viewed turn, and leaves a current one alone", () => {
    const markup = draw(null);
    expect(markup).toContain("text-danger");
    expect(markup).toContain("turn 23");
  });
});
