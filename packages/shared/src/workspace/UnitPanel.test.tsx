import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aReportUnit } from "@atlantis/core-client";
import type { UnitMovement, UnitPreview } from "@atlantis/core-client";
import { readRuleset } from "@atlantis/fixtures";
import { parseGameData, type GameDataEntry, type GameDataIndex } from "../gameData";
import { buildMagicTree } from "../magicTree";
import { standingOf } from "../magicStanding";
import { findByTestId } from "../testing/elementTree";
import { SURFACE, type HexNode } from "../hexMapModel";
import { UnitPanel } from "./UnitPanel";

const HEX: HexNode = {
  regionId: "1:7,53",
  coordinate: { x: 7, y: 53, z: SURFACE },
  terrain: "mountain",
  province: "Inholm",
  label: "Inholm",
  knowledge: "current",
  lastSeenTurn: 71,
  ageInTurns: 0,
  settlementName: "Inholm",
  ownUnitCount: 1,
  foreignUnitCount: 0,
  region: null
};

/** Only `byId` matters here: it is what decides an item tag's category. */
const indexWith = (ids: string[]): GameDataIndex => ({
  entries: [],
  byId: new Map(ids.map((id) => [id, { id } as GameDataEntry])),
  detailOf: () => null,
  revealedBy: new Map(),
  terrainResources: new Map()
});

const UNIT = aReportUnit({
  skills: [{ name: "lumberjack", tag: "LUMB", level: 1, points: 30 }],
  items: [
    { amount: 2, name: "wood", tag: "WOOD" },
    { amount: 1, name: "widget", tag: "ZZZZ" }
  ]
});

const draw = (props: Partial<Parameters<typeof UnitPanel>[0]> = {}) =>
  renderToStaticMarkup(<UnitPanel unit={UNIT} hex={HEX} {...props} />);

const RIDING: UnitMovement = {
  status: "ride",
  load: 60,
  fly: 0,
  ride: 70,
  walk: 85,
  capacityMode: "ride"
};

describe("naming game data in the unit pane", () => {
  it("opens a skill's game data entry from its name", () => {
    const html = draw({ gameData: indexWith([]), onOpenGameData: () => {} });
    expect(html).toContain('data-game-data-entry="skill:LUMB"');
  });

  it("links a skill's name and not its tag", () => {
    const html = draw({ gameData: indexWith([]), onOpenGameData: () => {} });
    expect(html).toContain(">lumberjack</button>");
    expect(html).not.toContain(">lumberjack LUMB</button>");
  });

  it("opens an item's game data entry from its name", () => {
    const html = draw({ gameData: indexWith(["equipment:WOOD"]), onOpenGameData: () => {} });
    expect(html).toContain('data-game-data-entry="equipment:WOOD"');
  });

  it("leaves an item whose category cannot be resolved as plain text", () => {
    const html = draw({ gameData: indexWith(["equipment:WOOD"]), onOpenGameData: () => {} });
    expect(html).toContain("widget");
    expect(html).not.toContain('data-game-data-entry="equipment:ZZZZ"');
    expect(html).not.toContain(">widget</button>");
  });

  it("links nothing while the ruleset has not loaded", () => {
    expect(draw()).not.toContain("data-game-data-entry");
    expect(draw({ gameData: null, onOpenGameData: () => {} })).not.toContain("data-game-data-entry");
  });
});

describe("a skill's study points in the unit pane (ah-ded4)", () => {
  it("renders level (points), the notation the report and the rest of the app use", () => {
    const html = renderToStaticMarkup(
      <UnitPanel
        unit={aReportUnit({ skills: [{ name: "mining", tag: "MINI", level: 2, points: 90 }], items: [] })}
        hex={HEX}
      />
    );

    expect(html).toContain("2 (90)");
    expect(html).not.toContain("2 · 90");
  });

  it("renders (0) for a skill with no points yet", () => {
    const html = renderToStaticMarkup(
      <UnitPanel
        unit={aReportUnit({ skills: [{ name: "mining", tag: "MINI", level: 0, points: 0 }], items: [] })}
        hex={HEX}
      />
    );

    expect(html).toContain("0 (0)");
  });
});

describe("the study tree door in the unit pane (ah-gjbs.1)", () => {
  const tree = buildMagicTree(parseGameData(readRuleset()) as GameDataIndex);

  const mage = aReportUnit({
    skills: [
      { name: "pattern", tag: "PATT", level: 1, points: 30 },
      { name: "force", tag: "FORC", level: 3, points: 450 }
    ],
    items: []
  });

  it("offers the study tree once for a mage, on their highest magic skill", () => {
    const opened: string[] = [];
    const panel = (
      <UnitPanel
        unit={mage}
        hex={HEX}
        magicTree={tree}
        onOpenMagicTree={(tag) => opened.push(tag)}
      />
    );

    const html = renderToStaticMarkup(panel);
    expect(html.split('data-testid="unit-magic-tree"').length - 1).toBe(1);
    expect(html).toContain("Show in study tree");
    expect(html).toContain("Mage");

    (findByTestId(panel, "unit-magic-tree").props.onClick as () => void)();
    expect(opened).toEqual(["FORC"]);
  });

  it("offers nothing for a unit holding no magic skill", () => {
    const html = renderToStaticMarkup(
      <UnitPanel unit={UNIT} hex={HEX} magicTree={tree} onOpenMagicTree={() => {}} />
    );
    expect(html).not.toContain('data-testid="unit-magic-tree"');
  });

  it("offers nothing while the ruleset has not loaded", () => {
    const html = renderToStaticMarkup(<UnitPanel unit={mage} hex={HEX} />);
    expect(html).not.toContain('data-testid="unit-magic-tree"');
    expect(html).not.toContain("Show in study tree");
  });

  it("says how much is open to a mage", () => {
    const index = parseGameData(readRuleset()) as GameDataIndex;
    const standing = standingOf(mage, buildMagicTree(index), index);
    const html = renderToStaticMarkup(
      <UnitPanel
        unit={mage}
        hex={HEX}
        magicTree={tree}
        onOpenMagicTree={() => {}}
        standing={standing}
      />
    );

    expect(html).toContain(`Mage — ${standing.counts.open} magic skills open`);
    expect(html).toContain("Show in study tree");
  });

  it("says only Mage without a standing", () => {
    const html = renderToStaticMarkup(
      <UnitPanel unit={mage} hex={HEX} magicTree={tree} onOpenMagicTree={() => {}} />
    );

    expect(html).toContain("Mage");
    expect(html).not.toContain("magic skills open");
  });
});

describe("battle-derived skills in the unit pane (ah-1mpx.6.3)", () => {
  const foreignUnit = aReportUnit({ own: false, skills: [], items: [] });

  it("a foreign unit groups battle skills under their source", () => {
    const html = renderToStaticMarkup(
      <UnitPanel
        unit={foreignUnit}
        hex={HEX}
        derivedSkills={[
          { name: "riding", tag: "RIDI", level: 5, turn: 71, coordinate: { x: 25, y: 55, z: 1 }, terrain: "ocean" },
          { name: "combat", tag: "COMB", level: 2, turn: 71, coordinate: { x: 25, y: 55, z: 1 }, terrain: "ocean" }
        ]}
      />
    );

    expect(html).toContain("Skills from battle reports");
    expect(html).toContain("riding 5, combat 2");
    expect(html).toContain("Seen in the battle in ocean (25,55), turn 71.");
  });

  it("a foreign unit with no recovered skills explains the empty battle section", () => {
    const html = renderToStaticMarkup(<UnitPanel unit={foreignUnit} hex={HEX} derivedSkills={[]} />);

    expect(html).toContain("Skills from battle reports");
    expect(html).toContain(
      "No battle we have seen involved this unit. A report never shows another faction&#x27;s skills."
    );
  });

  it("a real skill keeps the native Skills section even with derived skills supplied", () => {
    const html = renderToStaticMarkup(
      <UnitPanel
        unit={aReportUnit({ own: false, skills: [{ name: "combat", tag: "COMB", level: 3, points: 180 }] })}
        hex={HEX}
        derivedSkills={[
          { name: "riding", tag: "RIDI", level: 5, turn: 71, coordinate: null, terrain: null }
        ]}
      />
    );

    expect(html).not.toContain("Skills from battle reports");
    expect(html).toContain("3 (180)");
  });

  it("an own unit with no skills keeps the native empty Skills section, not the battle one", () => {
    const html = renderToStaticMarkup(
      <UnitPanel unit={aReportUnit({ own: true, skills: [] })} hex={HEX} />
    );

    expect(html).not.toContain("Skills from battle reports");
  });

  it("shows named movement capacities and the active mode", () => {
    const html = draw({ unit: aReportUnit({ movement: RIDING }) });

    expect(html).toContain("Riding");
    expect(html).toContain("Fastest available movement");
    expect(html).toContain("Fly");
    expect(html).toContain("70");
    expect(html).toContain("85");
    expect(html).toContain("The load is 60. Ride and Walk can carry it.");
  });

  it("uses the preview movement rather than the reported movement", () => {
    const preview: UnitPreview = {
      unit: aReportUnit({
        movement: { ...RIDING, status: "walk", capacityMode: "walk" }
      }),
      status: "present",
      changes: [{ field: "movement", original: "Riding" }],
      arrivingFrom: null,
      departingTo: null,
      aboard: null,
      uncounted: [],
      takenUnshown: [],
      produced: [],
      built: [],
      created: [],
      transportSent: [],
      transportReceived: [],
      transportTargetIssues: []
    };
    const html = draw({ unit: aReportUnit({ movement: RIDING }), preview });

    expect(html).toContain("Walking");
    expect(html).toContain("was: Riding");
  });
});
