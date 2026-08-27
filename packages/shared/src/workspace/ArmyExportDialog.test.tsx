import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArmyMemberRecord, ArmyRecord } from "@atlantis/core-client";

import { ArmyExportDialog } from "./ArmyExportDialog";

const NOW = "2026-08-27T09:00:00Z";

function aMember(overrides: Partial<ArmyMemberRecord> = {}): ArmyMemberRecord {
  return {
    unitId: "7954",
    name: "Shieldwall",
    factionId: "95",
    factionName: "Borg TNG",
    own: true,
    regionId: "1:7,53",
    flags: [],
    items: [],
    skills: [],
    combatSpell: null,
    men: 1,
    seenTurn: 71,
    seenAt: NOW,
    ...overrides
  };
}

function anArmy(id: string, name: string, members: ArmyMemberRecord[]): ArmyRecord {
  return { id, gameId: "game-1", name, members, createdAt: NOW, updatedAt: NOW };
}

const NORTHERN = anArmy("a", "Northern Host", [aMember()]);
const MIXED = anArmy("b", "Mixed Host", [
  aMember({ unitId: "1", seenTurn: 68 }),
  aMember({ unitId: "2", own: false })
]);

const dialog = (extra: Partial<Parameters<typeof ArmyExportDialog>[0]> = {}) => (
  <ArmyExportDialog
    armies={[NORTHERN, MIXED]}
    initialAttackerId={NORTHERN.id}
    currentTurn={71}
    busy={false}
    error={null}
    onExport={() => {}}
    onDismiss={() => {}}
    {...extra}
  />
);

/**
 * The dialog's markup, with the entities React escapes turned back into the characters the plan
 * spells - so an assertion can quote the shipped string rather than `turn&#x27;s`.
 */
const markupOf = (extra: Partial<Parameters<typeof ArmyExportDialog>[0]> = {}) =>
  renderToStaticMarkup(dialog(extra))
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

const noticeCount = (markup: string) =>
  markup.split('data-testid="army-export-notice"').length - 1;

/**
 * Whether the named control renders as disabled.
 *
 * Read out of the markup rather than off the element's props: this dialog holds state and uses
 * `useEscapeToDismiss`, so `elementTree`'s walk cannot enter it - `packages/shared` has no jsdom
 * (ah-nass), and `renderToStaticMarkup` is the whole of what a test here can see.
 */
const isDisabled = (markup: string, testId: string) => {
  const tag = new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`, "u").exec(markup);
  if (tag === null) {
    throw new Error(`no element with data-testid="${testId}" in the markup`);
  }
  return tag[0].includes(' disabled=""');
};

describe("ArmyExportDialog", () => {
  it("draws a refusal instead of a count", () => {
    const markup = markupOf({ armies: [], initialAttackerId: "" });

    expect(markup).toContain("No Armies to export. Make an Army first, then come back.");
    expect(markup).not.toContain("will be exported");
    expect(noticeCount(markup)).toBe(0);
    expect(isDisabled(markup, "army-export-confirm")).toBe(true);
    expect(isDisabled(markup, "army-export-swap")).toBe(true);
  });

  it("draws one notice line per caveat", () => {
    const markup = markupOf({ initialAttackerId: MIXED.id });

    expect(markup).toContain("2 units will be exported.");
    expect(markup).toContain(
      "1 unit was not in this turn's report. It goes out as it was when last seen."
    );
    expect(markup).toContain("1 unit belongs to another faction.");
    expect(markup).toContain("The defending side will be empty.");
    expect(noticeCount(markup)).toBe(3);
  });

  it("offers every Army on both sides, with its member count", () => {
    const markup = markupOf();

    expect(markup).toContain("Northern Host — 1 units");
    expect(markup).toContain("Mixed Host — 2 units");
    expect(markup).toContain("— none —");
    expect(markup).toContain("⇅ Swap sides");
    expect(markup).toContain('aria-label="Attackers"');
    expect(markup).toContain('aria-label="Defenders"');
  });

  it("enables the confirm when a side is chosen, and says so while busy", () => {
    expect(isDisabled(markupOf(), "army-export-confirm")).toBe(false);
    expect(markupOf()).toContain("Export…");
    expect(markupOf({ busy: true })).toContain("Exporting…");
    expect(isDisabled(markupOf({ busy: true }), "army-export-confirm")).toBe(true);
  });

  it("draws an error when one is given", () => {
    expect(markupOf({ error: "the disk is full" })).toContain("the disk is full");
    expect(markupOf()).not.toContain("army-export-error");
  });
});
