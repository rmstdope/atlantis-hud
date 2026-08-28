import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aReportUnit, type ArmyRecord, type ReportUnit } from "@atlantis/core-client";
import { ArmyMenuItems } from "./AddToArmyMenu";

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
  combatSpell: null,
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

/**
 * The list itself rather than `AddToArmyMenu`, because the frame round it is `PopoverFrame`, which
 * uses hooks - `testing/README.md` explains why that is unreachable from a static render here.
 */
const draw = (armies: ArmyRecord[], units: readonly ReportUnit[] = [UNIT]) =>
  renderToStaticMarkup(
    <ArmyMenuItems
      units={units}
      armies={armies}
      onAdd={() => {}}
      onNewArmy={() => {}}
      onDismiss={() => {}}
    />
  );

const buttonFor = (markup: string, id: string) =>
  new RegExp(`<button[^>]*data-testid="add-to-army-${id}"[\\s\\S]*?</button>`).exec(markup)?.[0] ?? "";

describe("the Add to army popover", () => {
  it("names the unit for one row and counts them for several", () => {
    expect(draw([army("a", "Coastal Watch")])).toContain("Outriders (9977) into…");
    expect(
      draw([army("a", "Coastal Watch")], [UNIT, aReportUnit({ unitId: "1", name: "Vanguard" })])
    ).toContain("2 units into…");
  });

  it("ticks and disables an Army that already holds every picked unit", () => {
    const markup = draw(
      [army("a", "Northern Host", ["9977", "1"]), army("b", "Coastal Watch")],
      [UNIT, aReportUnit({ unitId: "1", name: "Vanguard" })]
    );

    // The attribute, not the `disabled:` variants in the class list.
    expect(buttonFor(markup, "a")).toContain('disabled=""');
    expect(buttonFor(markup, "a")).toContain("✓");
    // A menu called Add to army only ever adds, so nothing destructive can happen by mis-clicking.
    expect(buttonFor(markup, "b")).not.toContain('disabled=""');
    expect(buttonFor(markup, "b")).not.toContain("✓");
  });

  it("an Army holding some of the pick stays live and says how many it already has", () => {
    const markup = draw(
      [army("a", "Northern Host", ["9977"])],
      [UNIT, aReportUnit({ unitId: "1", name: "Vanguard" })]
    );

    // E4: choosing it adds only the ones that are missing, so it must not read as inert.
    expect(buttonFor(markup, "a")).not.toContain('disabled=""');
    expect(buttonFor(markup, "a")).toContain("1 already in");
  });

  it("says nothing about an Army holding none of them", () => {
    expect(buttonFor(draw([army("a", "Coastal Watch")]), "a")).not.toContain("already in");
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
    expect(draw([])).toContain("New Army…");
  });
});
