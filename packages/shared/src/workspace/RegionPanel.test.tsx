import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { CoreClient, MapLevel, OpenedGame, OrderDiagnostic } from "@atlantis/core-client";
import { aReportRegion } from "@atlantis/core-client";
import type { GameDataEntry, GameDataIndex } from "../gameData";
import { SURFACE, type HexNode } from "../hexMapModel";
import { resetHexNotesStore } from "../hexNotesStore";
import { RegionPanel } from "./RegionPanel";
import { resetWorkspaceStore } from "../workspaceStore";

const CLIENT = {} as unknown as CoreClient;

const GAME = {
  gameFilePath: "g.json",
  databasePath: "g.sqlite",
  schemaVersion: 8,
  manifest: {
    manifestVersion: 1,
    metadata: { gameId: "aug-2026", gameName: "Borg TNG", rulesetId: "neworigins" },
    reportSources: [],
    createdAt: "2026-08-01T09:00:00Z",
    lastOpenedAt: "2026-08-09T18:00:00Z"
  }
} as OpenedGame;

/** A minimal but visited hex, enough to reach the region facts below the Problems section. */
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
  foreignUnitCount: 91,
  region: aReportRegion({
    regionId: "1:7,53",
    coordinate: { x: 7, y: 53, z: SURFACE },
    terrain: "mountain",
    province: "Inholm",
    settlement: { name: "Inholm", size: "city" },
    population: 8500,
    race: "highelf",
    taxBase: 1200,
    wages: "$14",
    maxWages: 16,
    entertainment: 200
  })
};

const PROBLEMS: OrderDiagnostic[] = [
  {
    code: "not-enough-silver",
    message: "This hex's shared purse is short.",
    lineStart: null,
    lineEnd: null,
    columnStart: null,
    columnEnd: null,
    regionId: "1:7,53",
    unitId: null,
    severity: "warning"
  },
  {
    code: "hex-unguarded",
    message: "Nobody is guarding this hex.",
    lineStart: null,
    lineEnd: null,
    columnStart: null,
    columnEnd: null,
    regionId: "1:7,53",
    unitId: null,
    severity: "warning"
  },
  {
    code: "syntax-error",
    message: "Unknown order.",
    lineStart: 1,
    lineEnd: 1,
    columnStart: 0,
    columnEnd: 4,
    regionId: "1:7,53",
    unitId: "18642",
    severity: "error"
  }
];

const draw = (problems: OrderDiagnostic[] = []) =>
  renderToStaticMarkup(
    <RegionPanel hex={HEX} problems={problems} client={CLIENT} game={GAME} turn={71} />
  );

describe("the region panel's problems toggle", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  it("offers no problems toggle on a hex with nothing wrong", () => {
    const markup = draw([]);

    expect(markup).not.toContain("region-problems-toggle");
  });

  it("puts a problems toggle in the header, with the count", () => {
    const markup = draw(PROBLEMS);

    expect(markup).toContain("region-problems-toggle");
    // Tied to the count specifically, not to "3" appearing anywhere in the markup - the panel
    // body also carries digits of its own, in the hex's coordinates.
    expect(markup).toMatch(/aria-label="Problems 3"/);
    expect(markup).toMatch(/Problems.*3/);
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*data-testid="region-problems-toggle"/);
  });

  it("shows the problems by default", () => {
    const markup = draw(PROBLEMS);

    expect(markup).toContain("region-problems");
  });
});

describe("the region panel's problem rows (ah-uia)", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  it("boxes the problems without repeating the hex name", () => {
    const markup = draw(PROBLEMS);

    expect(markup).toContain("overflow-hidden rounded border border-edge bg-panel");
    expect(markup).not.toContain("bg-brass/10");
  });

  it("marks each problem with a glyph and says hex where there is no unit", () => {
    const markup = draw(PROBLEMS);

    expect(markup).toContain("⚠");
    expect(markup).toContain("✕");
    expect(markup).toContain(">hex<");
    expect(markup).toContain(">unit <");
    expect(markup).toContain("18642");
  });
});

describe("the region panel's Notes section (ah-o1t)", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  it("renders the Notes section after Structures, on a known hex", () => {
    const markup = draw([]);

    expect(markup).toContain('data-testid="region-notes"');
    expect(markup.indexOf("Structures")).toBeLessThan(markup.indexOf('data-testid="region-notes"'));
  });

  it("renders the Notes section on an unexplored hex too, keyed by the coordinate's regionId", () => {
    const markup = renderToStaticMarkup(
      <RegionPanel
        hex={null}
        unknown={{ x: 3, y: 4, z: SURFACE }}
        client={CLIENT}
        game={GAME}
        turn={71}
      />
    );

    expect(markup).toContain('data-testid="region-notes"');
  });
});

describe("the region panel's sentence for an unexplored hex off the surface", () => {
  const LEVELS: MapLevel[] = [
    { z: 1, name: "surface" },
    { z: 2, name: "underworld" }
  ];

  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  it("names the underworld", () => {
    const markup = renderToStaticMarkup(
      <RegionPanel
        hex={null}
        unknown={{ x: 7, y: 53, z: 2 }}
        levels={LEVELS}
        client={CLIENT}
        game={GAME}
        turn={71}
      />
    );

    expect(markup).toContain("named it, in the underworld.");
  });

  it("stays silent on the surface", () => {
    const markup = renderToStaticMarkup(
      <RegionPanel
        hex={null}
        unknown={{ x: 7, y: 53, z: SURFACE }}
        levels={LEVELS}
        client={CLIENT}
        game={GAME}
        turn={71}
      />
    );

    expect(markup).toContain("named it.");
  });

  it("names the nexus", () => {
    const markup = renderToStaticMarkup(
      <RegionPanel
        hex={null}
        unknown={{ x: 2, y: 0, z: 0 }}
        levels={[{ z: 0, name: "nexus" }, ...LEVELS]}
        client={CLIENT}
        game={GAME}
        turn={71}
      />
    );

    expect(markup).toContain("named it, in the nexus.");
  });
});

describe("the region panel's structure list", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  it("writes each structure as name, number and type", () => {
    const hex: HexNode = {
      ...HEX,
      region: aReportRegion({
        ...HEX.region!,
        structures: [
          {
            structureId: "12",
            name: "Odds and Ends",
            kind: "Fort",
            description: null,
            needs: null
          }
        ]
      })
    };

    const markup = renderToStaticMarkup(
      <RegionPanel hex={hex} problems={[]} client={CLIENT} game={GAME} turn={71} />
    );

    expect(markup).toContain("Odds and Ends [12] · Fort");
  });
});

describe("the region panel's unit numbers are a way to go there (ah-87he)", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  it("the unit id is a button when a handler is given", () => {
    const markup = renderToStaticMarkup(
      <RegionPanel
        hex={HEX}
        problems={PROBLEMS}
        client={CLIENT}
        game={GAME}
        turn={71}
        known={new Set(["18642"])}
        onSelectUnit={() => {}}
      />
    );

    expect(markup).toContain('data-testid="problem-unit-18642"');
    expect(markup).toContain("text-brass");
  });

  it("keeps the plain span when no handler is given", () => {
    expect(draw(PROBLEMS)).not.toContain('data-testid="problem-unit-');
  });
});

/** Only `byId` matters here: it is what decides an item tag's category. */
const indexWith = (ids: string[]): GameDataIndex => ({
  entries: [],
  byId: new Map(ids.map((id) => [id, { id } as GameDataEntry])),
  detailOf: () => null
});

const MARKET_HEX: HexNode = {
  ...HEX,
  region: aReportRegion({
    regionId: "1:7,53",
    coordinate: { x: 7, y: 53, z: SURFACE },
    terrain: "mountain",
    province: "Inholm",
    products: [
      { amount: 24, name: "wood", tag: "WOOD" },
      { amount: 5, name: "iron", tag: "IRON" }
    ],
    wanted: [{ amount: 12, name: "grain", tag: "GRAI", price: 40 }],
    forSale: [{ amount: 3, name: "leather", tag: "LEAT", price: 90 }],
    structures: [
      { structureId: "12", name: "Odds and Ends", kind: "Fort", needs: null } as never
    ]
  })
};

const drawMarket = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <RegionPanel hex={MARKET_HEX} client={CLIENT} game={GAME} turn={71} {...props} />
  );

describe("naming game data in the region panel", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  const linked = {
    gameData: indexWith(["equipment:WOOD", "equipment:IRON", "equipment:GRAI", "equipment:LEAT"]),
    onOpenGameData: () => {}
  };

  it("opens a market good's game data entry from its name", () => {
    const html = drawMarket(linked);
    expect(html).toContain('data-game-data-entry="equipment:GRAI"');
    expect(html).toContain('data-game-data-entry="equipment:LEAT"');
  });

  it("links each product's name inside the products line, and leaves the amounts alone", () => {
    const html = drawMarket(linked);
    expect(html).toContain('data-game-data-entry="equipment:WOOD"');
    expect(html).toContain(">wood</button>");
    expect(html).not.toContain(">24 wood</button>");
    expect(html).toContain("24 ");
    expect(html).toContain(" · ");
  });

  it("links a structure's kind, and not its name or its number", () => {
    const html = drawMarket(linked);
    expect(html).toContain('data-game-data-entry="building:FORT"');
    expect(html).toContain(">Fort</button>");
    expect(html).not.toContain(">Odds and Ends</button>");
    expect(html).toContain("Odds and Ends [12]");
  });

  it("links nothing while the ruleset has not loaded", () => {
    expect(drawMarket()).not.toContain("data-game-data-entry");
  });
});
