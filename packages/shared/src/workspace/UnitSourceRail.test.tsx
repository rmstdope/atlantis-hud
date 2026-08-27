import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArmyRecord } from "@atlantis/core-client";
import { HEX_SOURCE, OWN_SOURCE, type UnitSource } from "./unitSource";
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
    mode?: RailMode;
    canEdit?: boolean;
  } = {}
): string {
  return renderToStaticMarkup(
    <UnitSourceRail
      source={overrides.source ?? HEX_SOURCE}
      onSource={() => {}}
      armies={overrides.armies ?? ARMIES}
      hexCount={overrides.hexCount === undefined ? 6 : overrides.hexCount}
      ownCount={overrides.ownCount ?? 38}
      mode={overrides.mode ?? { kind: "idle" }}
      onEvent={() => {}}
      canEdit={overrides.canEdit ?? true}
    />
  );
}

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
    const markup = draw({ mode: { kind: "creating", draft: "Coastal", withUnit: null } });

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
      { unitId: "1", name: "a", factionId: null, factionName: null, own: true, regionId: "1:7,53", flags: [], items: [], skills: [], men: 1, seenTurn: 71, seenAt: "x" },
      { unitId: "2", name: "b", factionId: null, factionName: null, own: true, regionId: "1:7,53", flags: [], items: [], skills: [], men: 1, seenTurn: 71, seenAt: "x" }
    ];

    expect(draw({ armies: [withMembers] })).toContain(">2<");
  });
});
