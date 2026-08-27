import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aReportUnit, type ArmyRecord } from "@atlantis/core-client";
import { AddToArmyMenu } from "./AddToArmyMenu";

const member = (unitId: string) => ({
  unitId,
  name: "Outriders",
  factionId: null,
  factionName: null,
  own: true,
  regionId: "1:7,53",
  flags: [],
  items: [],
  skills: [],
  men: 1,
  seenTurn: 71,
  seenAt: "2026-08-01T09:00:00Z"
});

const army = (id: string, name: string, members: string[] = []): ArmyRecord => ({
  id,
  gameId: "aug-2026",
  name,
  members: members.map(member),
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z"
});

const UNIT = aReportUnit({ unitId: "9977", name: "Outriders" });

const draw = (armies: ArmyRecord[]) =>
  renderToStaticMarkup(
    <AddToArmyMenu
      unit={UNIT}
      armies={armies}
      onAdd={() => {}}
      onNewArmy={() => {}}
      onDismiss={() => {}}
    />
  );

describe("the Add to army popover", () => {
  it("names the unit it is about on its first line", () => {
    expect(draw([army("a", "Coastal Watch")])).toContain("Outriders (9977) into…");
  });

  it("ticks and disables an Army the unit is already in", () => {
    const markup = draw([army("a", "Northern Host", ["9977"]), army("b", "Coastal Watch")]);
    const northern = /<button[^>]*data-testid="add-to-army-a"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";
    const coastal = /<button[^>]*data-testid="add-to-army-b"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";

    // The attribute, not the `disabled:` variants in the class list.
    expect(northern).toContain('disabled=""');
    expect(northern).toContain("✓");
    // A menu called Add to army only ever adds, so nothing destructive can happen by mis-clicking.
    expect(coastal).not.toContain('disabled=""');
    expect(coastal).not.toContain("✓");
  });

  it("lists New Army last, after a separator", () => {
    const markup = draw([army("a", "Coastal Watch")]);

    expect(markup).toContain("New Army…");
    expect(markup.indexOf("Coastal Watch")).toBeLessThan(markup.indexOf("New Army…"));
    expect(markup).toContain('data-testid="add-to-army-separator"');
    expect(markup.indexOf('data-testid="add-to-army-separator"')).toBeLessThan(
      markup.indexOf("New Army…")
    );
  });

  it("offers New Army even when there is no Army yet", () => {
    const markup = draw([]);

    expect(markup).toContain("New Army…");
  });
});
