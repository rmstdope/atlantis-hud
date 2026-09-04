import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aReportUnit, type AlliedMageRecord } from "@atlantis/core-client";
import type { PendingMissingMages } from "../mageSheetImport";
import { MissingMagesPrompt } from "./MissingMagesPrompt";

function missingMage(unitId: string, name: string): AlliedMageRecord {
  return {
    factionId: "21",
    factionName: "Borg",
    unit: aReportUnit({
      unitId,
      name,
      own: false,
      skills: [{ name: "force", tag: "FORC", level: 3, points: 180 }]
    }),
    sheetTurn: 21,
    receivedAt: "2026-01-01T00:00:00.000Z"
  };
}

const PENDING: PendingMissingMages = {
  factionLabel: "Borg (21)",
  sheetTurn: 23,
  taken: 4,
  missing: [missingMage("1204", "Alrik"), missingMage("1301", "Bela")]
};

// Static markup only: `packages/shared` has no jsdom (ah-nass), so the Escape listener and the
// focus move cannot be observed here. Both are in the bead's *Validation*, for a person to check.
function markup(pending = PENDING, busy = false): string {
  return renderToStaticMarkup(
    <MissingMagesPrompt pending={pending} busy={busy} onDiscard={() => {}} onKeep={() => {}} />
  );
}

describe("MissingMagesPrompt", () => {
  it("asks the question, names the mages, and offers the two answers", () => {
    const html = markup();

    expect(html).toContain("missing-mages-prompt");
    expect(html).toContain(
      "Borg (21)&#x27;s turn 23 sheet leaves out 2 mages that its turn 21 sheet had:"
    );
    expect(html).toContain("Alrik (1204) — force 3, last seen turn 21");
    expect(html).toContain("Bela (1301) — force 3, last seen turn 21");
    expect(html).toContain("Discard them if Borg (21) has lost them.");
    expect(html).toContain("Discard them</button>");
    expect(html).toContain("Keep as stale</button>");
  });

  it("counts the mages it does not name", () => {
    const missing = Array.from({ length: 11 }, (_one, index) =>
      missingMage(`${1200 + index}`, `Mage ${index}`)
    );

    const html = markup({ ...PENDING, missing });

    expect(html).toContain("and 6 more");
    expect(html.match(/<li/gu)).toHaveLength(6);
  });

  it("disables both answers while the workspace is busy", () => {
    // The attribute, not the `disabled:opacity-50` class both renders carry. Keep writes nothing,
    // but a box where one of two answers greys out mid-write reads as broken.
    const busy = markup(PENDING, true);
    expect(busy).toContain('data-testid="missing-mages-discard" disabled=""');
    expect(busy).toContain('data-testid="missing-mages-keep" disabled=""');
    expect(markup(PENDING, false)).not.toContain('disabled=""');
  });
});
