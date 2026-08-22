import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { aReportUnit } from "@atlantis/core-client";
import type { GameDataEntry, GameDataIndex } from "../gameData";
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
  detailOf: () => null
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
