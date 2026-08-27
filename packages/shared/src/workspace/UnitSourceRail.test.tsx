import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArmyRecord } from "@atlantis/core-client";
import { FOREIGN_SOURCE, HEX_SOURCE, OWN_SOURCE, type UnitSource } from "./unitSource";
import { UnitSourceRail } from "./UnitSourceRail";
import type { RailMode } from "./railEditState";

const army = (id: string, name: string): ArmyRecord => ({
  id,
  gameId: "aug-2026",
  name,
  members: [],
  createdAt: "2026-08-01T09:00:00Z",
  updatedAt: "2026-08-01T09:00:00Z"
});

const ARMIES = [army("a", "Coastal Watch"), army("b", "Northern Host")];

function draw(
  overrides: {
    source?: UnitSource;
    armies?: readonly ArmyRecord[];
    hexCount?: number | null;
    ownCount?: number;
    foreignCount?: number;
    mode?: RailMode;
    canEdit?: boolean;
    dropOver?: { kind: "army"; armyId: string } | { kind: "new" } | null;
    dropFull?: ReadonlySet<string>;
    dragging?: boolean;
  } = {}
): string {
  return renderToStaticMarkup(
    <UnitSourceRail
      source={overrides.source ?? HEX_SOURCE}
      onSource={() => {}}
      armies={overrides.armies ?? ARMIES}
      hexCount={overrides.hexCount === undefined ? 6 : overrides.hexCount}
      ownCount={overrides.ownCount ?? 38}
      foreignCount={overrides.foreignCount ?? 254}
      mode={overrides.mode ?? { kind: "idle" }}
      onEvent={() => {}}
      canEdit={overrides.canEdit ?? true}
      dropOver={overrides.dropOver ?? null}
      dropFull={overrides.dropFull ?? new Set()}
      dragging={overrides.dragging ?? false}
    />
  );
}

const entryFor = (markup: string, id: string) =>
  new RegExp(`<button[^>]*data-testid="unit-source-${id}"[\\s\\S]*?</button>`).exec(markup)?.[0] ?? "";

describe("the units dock's source rail", () => {
  it("lists every Army under the heading, with This hex and All my units above it", () => {
    const markup = draw();

    expect(markup).toContain("This hex");
    expect(markup).toContain("All my units");
    expect(markup).toContain("Armies");
    expect(markup).toContain("Coastal Watch");
    expect(markup).toContain("Northern Host");
    // The order on screen, which is what the rail is: the two built-in sources, then the heading.
    expect(markup.indexOf("This hex")).toBeLessThan(markup.indexOf("All my units"));
    expect(markup.indexOf("All my units")).toBeLessThan(markup.indexOf("Armies"));
    expect(markup.indexOf("Armies")).toBeLessThan(markup.indexOf("Coastal Watch"));
  });

  it("the rail offers Other factions between All my units and the Armies", () => {
    const markup = draw();

    expect(markup).toContain('data-testid="unit-source-foreign"');
    expect(markup).toContain("Other factions");
    expect(markup.indexOf("All my units")).toBeLessThan(markup.indexOf("Other factions"));
    expect(markup.indexOf("Other factions")).toBeLessThan(markup.indexOf("Armies"));
  });

  it("offers Other factions with no game open, and counts them", () => {
    // It needs a report, not a game: unlike the Armies group it is always drawn, and a count of
    // zero is a true and useful statement.
    const markup = draw({ canEdit: false, foreignCount: 0 });

    expect(markup).toContain('data-testid="unit-source-foreign"');
    expect(markup).toContain("Other factions");
    expect(markup).not.toContain("+ New Army");
  });

  it("marks Other factions as the chosen source when it is", () => {
    const markup = draw({ source: FOREIGN_SOURCE });

    expect(markup).toMatch(/data-testid="unit-source-foreign"[^>]*data-selected="true"/u);
    expect(markup).toMatch(/data-testid="unit-source-own"[^>]*data-selected="false"/u);
  });

  it("counts the hex and the player's own units beside their entries", () => {
    const markup = draw({ hexCount: 9, ownCount: 38 });

    expect(markup).toContain(">9<");
    expect(markup).toContain(">38<");
  });

  it("omits the hex count when no hex is selected", () => {
    const markup = draw({ hexCount: null });

    expect(markup).toContain("This hex");
    expect(markup).not.toContain(">6<");
  });

  it("marks This hex in brass while an Army is the source", () => {
    const onHex = draw({ source: HEX_SOURCE, hexCount: 9 });
    const onArmy = draw({ source: { kind: "army", armyId: "a" }, hexCount: 9 });

    // The ● means "the table is not about the hex on the map", and it carries the hex's own count.
    expect(onArmy).toContain("●");
    expect(onArmy).toContain("text-brass-bright");
    expect(onHex).not.toContain("●");
  });

  it("marks This hex in brass for All my units too", () => {
    expect(draw({ source: OWN_SOURCE })).toContain("●");
  });

  it("renders no Armies group when no game is open", () => {
    const markup = draw({ canEdit: false, armies: [] });

    expect(markup).toContain("This hex");
    expect(markup).toContain("All my units");
    expect(markup).not.toContain("Armies");
    expect(markup).not.toContain("New Army");
  });

  it("puts a name field in the rail while a new Army is being created", () => {
    const markup = draw({ mode: { kind: "creating", draft: "Coastal", withUnits: [] } });

    expect(markup).toContain('data-testid="rail-name-field"');
    expect(markup).toContain('value="Coastal"');
  });

  it("puts a name field in the row being renamed, and leaves the others alone", () => {
    const markup = draw({ mode: { kind: "renaming", armyId: "a", draft: "Coastal Watch!" } });

    expect(markup).toContain('data-testid="rail-name-field"');
    expect(markup).toContain('value="Coastal Watch!"');
    // The other Army is still a plain row.
    expect(markup).toContain("Northern Host");
  });

  it("offers a new Army whenever a game is open", () => {
    expect(draw()).toContain("+ New Army");
  });

  it("counts each Army's members beside it", () => {
    const withMembers = army("c", "Siege Train");
    withMembers.members = [
      { unitId: "1", name: "a", factionId: null, factionName: null, own: true, regionId: "1:7,53", flags: [], items: [], skills: [], combatSpell: null, men: 1, seenTurn: 71, seenAt: "x" },
      { unitId: "2", name: "b", factionId: null, factionName: null, own: true, regionId: "1:7,53", flags: [], items: [], skills: [], combatSpell: null, men: 1, seenTurn: 71, seenAt: "x" }
    ];

    expect(draw({ armies: [withMembers] })).toContain(">2<");
  });

  it("outlines the Army a drag is over", () => {
    const markup = draw({ dragging: true, dropOver: { kind: "army", armyId: "b" } });

    expect(entryFor(markup, "army-b")).toContain("border-dashed");
    expect(entryFor(markup, "army-a")).not.toContain("border-dashed");
  });

  it("outlines + New Army when the drag is over it", () => {
    const markup = draw({ dragging: true, dropOver: { kind: "new" } });
    const newArmy = /<button[^>]*data-testid="rail-new-army"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";

    expect(newArmy).toContain("border-dashed");
  });

  it("marks an Army that would take nothing and gives it no drop attribute", () => {
    const markup = draw({ dragging: true, dropFull: new Set(["a"]) });

    // W3: you learn before letting go, in the same ✓ the menu uses for the same fact.
    expect(entryFor(markup, "army-a")).toContain("✓");
    expect(entryFor(markup, "army-a")).toContain("opacity-40");
    expect(entryFor(markup, "army-a")).not.toContain("data-drop-army");
    expect(entryFor(markup, "army-b")).toContain('data-drop-army="b"');
  });

  it("carries the drop attributes only while a drag is in flight", () => {
    expect(draw()).not.toContain("data-drop-army");
    expect(draw()).not.toContain("data-drop-new");
    expect(draw({ dragging: true })).toContain('data-drop-army="a"');
    expect(draw({ dragging: true })).toContain('data-drop-new="true"');
  });

  it("leaves This hex and All my units alone during a drag", () => {
    const markup = draw({ dragging: true, dropOver: { kind: "army", armyId: "a" } });

    // Dimming them was rejected: brass on `This hex` already means something else (U4).
    expect(entryFor(markup, "hex")).not.toContain("data-drop");
    expect(entryFor(markup, "hex")).not.toContain("opacity-40");
    expect(entryFor(markup, "own")).not.toContain("data-drop");
    expect(entryFor(markup, "own")).not.toContain("opacity-40");
  });
});
