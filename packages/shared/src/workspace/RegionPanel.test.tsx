import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  CoreClient,
  MapLevel,
  OpenedGame,
  OrderDiagnostic,
  ReportRegion
} from "@atlantis/core-client";
import { aReportRegion, aReportUnit, aStructure } from "@atlantis/core-client";
import type { GameDataEntry, GameDataIndex } from "../gameData";
import type { RememberedResource } from "../resourceMemory";
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
    formed: null,
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
    formed: null,
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
    formed: null,
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
            kind: "Fort", baseKind: "Fort", qualifiers: [], vessels: [],
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
  detailOf: () => null,
  revealedBy: new Map(),
  terrainResources: new Map()
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

/**
 * A fleet names several vessels in one kind, and each of them is a real dictionary entry
 * (ah-t5fk). Every string here is from `tests/fixtures/reports/*.rep`.
 */
describe("a fleet's vessels are each their own link (ah-t5fk)", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  const shipsIndex: GameDataIndex = {
    entries: [
      { id: "ship:GLLY", category: "ship", name: "Galley", tag: "GLLY" },
      { id: "ship:GALL", category: "ship", name: "Galleon", tag: "GALL" },
      { id: "ship:BALL", category: "ship", name: "Balloon", tag: "BALL" }
    ] as GameDataEntry[],
    byId: new Map(),
    detailOf: () => null,
    revealedBy: new Map(),
    terrainResources: new Map()
  };

  const withStructure = (kind: string, needs: number | null = null): HexNode => ({
    ...HEX,
    region: aReportRegion({
      ...HEX.region!,
      structures: [
        aStructure(kind, { structureId: "194", name: "Frozen Tomb", needs })
      ]
    })
  });

  const draw = (kind: string, needs: number | null = null) =>
    renderToStaticMarkup(
      <RegionPanel
        hex={withStructure(kind, needs)}
        problems={[]}
        client={CLIENT}
        game={GAME}
        turn={71}
        gameData={shipsIndex}
        onOpenGameData={() => {}}
      />
    );

  const MANIFEST = "Galley, 40 Galleons, 11 Galleys, 10 Balloons";

  it("renders one link per named vessel", () => {
    const html = draw(MANIFEST);
    expect(html).toContain('data-game-data-entry="ship:GLLY"');
    expect(html).toContain('data-game-data-entry="ship:GALL"');
    expect(html).toContain('data-game-data-entry="ship:BALL"');
    expect(html).toContain(">Galley</button>");
    expect(html).toContain(">Galleons</button>");
    expect(html).toContain(">Galleys</button>");
    expect(html).toContain(">Balloons</button>");
  });

  it("leaves the counts as plain text", () => {
    const html = draw(MANIFEST);
    expect(html).not.toContain(">40 Galleons</button>");
    expect(html).toContain("40 ");
    expect(html).toContain("11 ");
    expect(html).toContain("10 ");
  });

  it("links a single-vessel structure to its ship entry", () => {
    // `Ship [623] : Galley` was a dead building lookup before this bead.
    const html = draw("Galley");
    expect(html).toContain('data-game-data-entry="ship:GLLY"');
    expect(html).not.toContain('data-game-data-entry="building:GALLEY"');
  });

  it("leaves an ordinary building exactly as it was, needs and all", () => {
    const html = draw("Stockade", 20);
    expect(html).toContain('data-game-data-entry="building:STOCKADE"');
    expect(html).toContain(">Stockade</button>");
    expect(html).toContain(", needs 20");
    expect(html).not.toContain(">, needs 20</button>");
  });

  it("still links a vessel name the catalogue does not describe", () => {
    const html = draw("Galley, 2 Dinghies");
    expect(html).toContain(">Dinghies</button>");
  });

  it("keeps the structure's own name and number plain", () => {
    const html = draw(MANIFEST);
    expect(html).toContain("Frozen Tomb [194]");
    expect(html).not.toContain(">Frozen Tomb</button>");
  });
});

describe("hidden resources in the products line (ah-rx0r.2)", () => {
  beforeEach(() => {
    resetWorkspaceStore();
    resetHexNotesStore();
  });

  const NAMES = indexWith(["equipment:FLOA", "equipment:MUSH", "equipment:LIVE", "equipment:WOOD", "equipment:HERB"]);

  const revealing = (over: Partial<GameDataIndex> = {}): GameDataIndex => ({
    ...NAMES,
    byId: new Map([
      ["equipment:FLOA", { id: "equipment:FLOA", category: "equipment", name: "floater hide", tag: "FLOA" }],
      ["equipment:MUSH", { id: "equipment:MUSH", category: "equipment", name: "mushroom", tag: "MUSH" }],
      ["equipment:LIVE", { id: "equipment:LIVE", category: "equipment", name: "livestock", tag: "LIVE" }],
      ["equipment:WOOD", { id: "equipment:WOOD", category: "equipment", name: "wood", tag: "WOOD" }],
      ["equipment:HERB", { id: "equipment:HERB", category: "equipment", name: "herbs", tag: "HERB" }]
    ] as [string, GameDataEntry][]),
    revealedBy: new Map([
      ["FLOA", { skillTag: "HUNT", skillName: "hunting", level: 3 }],
      ["MUSH", { skillTag: "HERB", skillName: "herb lore", level: 3 }]
    ]),
    terrainResources: new Map([["swamp", ["WOOD", "FLOA", "HERB", "MUSH"]]]),
    ...over
  });

  /** swamp (36,46) in Pangmore, turn 23 of neworigins-3.0.0-g5-f21-t23.rep. */
  const swampHex = (over: Partial<ReportRegion> = {}): HexNode => ({
    ...MARKET_HEX,
    terrain: "swamp",
    region: aReportRegion({
      ...MARKET_HEX.region!,
      terrain: "swamp",
      products: [
        { amount: 12, name: "livestock", tag: "LIVE" },
        { amount: 16, name: "wood", tag: "WOOD" },
        { amount: 18, name: "herbs", tag: "HERB" }
      ],
      units: [
        aReportUnit({
          unitId: "11851",
          skills: [{ name: "hunting", tag: "HUNT", level: 3, points: 180 }]
        }),
        aReportUnit({
          unitId: "9595",
          skills: [{ name: "herb lore", tag: "HERB", level: 1, points: 50 }]
        })
      ],
      ...over
    })
  });

  const draw = (hex: HexNode, gameData: GameDataIndex | null) =>
    renderToStaticMarkup(
      <RegionPanel
        hex={hex}
        client={CLIENT}
        game={GAME}
        turn={71}
        gameData={gameData}
        onOpenGameData={() => {}}
      />
    );

  it("says a resource is absent where a skilled unit of yours stands", () => {
    const html = draw(swampHex(), revealing());

    expect(html).toContain(
      "A unit with hunting 3 stands here, and the report names no floater hide."
    );
    expect(html).toMatch(/0 <button[^>]*data-game-data-entry="equipment:FLOA"[^>]*>floater hide<\/button>/);
  });

  it("names a resource nobody here could check", () => {
    const html = draw(swampHex(), revealing());

    expect(html).toContain(">mushroom</button>?");
    expect(html).toContain(
      "No unit of yours here has herb lore 3, so whether this hex holds mushroom is unknown."
    );
  });

  it("leaves the products line alone when the catalogue cannot say", () => {
    const html = draw(swampHex(), NAMES);

    expect(html).not.toContain("floater hide");
    expect(html).not.toContain("mushroom");
  });

  it("shows the products section on a hex whose only news is an absence", () => {
    const html = draw(swampHex({ products: [] }), revealing());

    expect(html).toContain("Products");
    expect(html).toMatch(/0 <button[^>]*>floater hide<\/button>/);
  });
});

describe("resource verdicts carried over from earlier turns (ah-tgtp)", () => {
  const NAMES = indexWith([
    "equipment:FLOA",
    "equipment:MUSH",
    "equipment:LIVE",
    "equipment:WOOD",
    "equipment:HERB"
  ]);

  const revealing = (): GameDataIndex => ({
    ...NAMES,
    byId: new Map([
      ["equipment:FLOA", { id: "equipment:FLOA", category: "equipment", name: "floater hide", tag: "FLOA" }],
      ["equipment:MUSH", { id: "equipment:MUSH", category: "equipment", name: "mushroom", tag: "MUSH" }],
      ["equipment:LIVE", { id: "equipment:LIVE", category: "equipment", name: "livestock", tag: "LIVE" }],
      ["equipment:WOOD", { id: "equipment:WOOD", category: "equipment", name: "wood", tag: "WOOD" }],
      ["equipment:HERB", { id: "equipment:HERB", category: "equipment", name: "herbs", tag: "HERB" }]
    ] as [string, GameDataEntry][]),
    revealedBy: new Map([
      ["FLOA", { skillTag: "HUNT", skillName: "hunting", level: 3 }],
      ["MUSH", { skillTag: "HERB", skillName: "herb lore", level: 3 }]
    ]),
    terrainResources: new Map([["swamp", ["WOOD", "FLOA", "HERB", "MUSH"]]])
  });

  /** The same swamp with the hunter gone: turn 39 of g5-f21, where only the herbalist remains. */
  const hunterless = (): HexNode => ({
    ...MARKET_HEX,
    terrain: "swamp",
    region: aReportRegion({
      ...MARKET_HEX.region!,
      terrain: "swamp",
      products: [
        { amount: 12, name: "livestock", tag: "LIVE" },
        { amount: 16, name: "wood", tag: "WOOD" },
        { amount: 18, name: "herbs", tag: "HERB" }
      ],
      units: [
        aReportUnit({
          unitId: "9595",
          skills: [{ name: "herb lore", tag: "HERB", level: 1, points: 50 }]
        })
      ]
    })
  });

  const memory = (over: Partial<RememberedResource> = {}) =>
    new Map<string, RememberedResource>([
      ["FLOA", { tag: "FLOA", amount: 0, name: null, turn: 23, ...over }]
    ]);

  const draw = (
    hex: HexNode,
    gameData: GameDataIndex | null,
    remembered?: ReadonlyMap<string, RememberedResource>,
    turn = 39
  ) =>
    renderToStaticMarkup(
      <RegionPanel
        hex={hex}
        client={CLIENT}
        game={GAME}
        turn={turn}
        gameData={gameData}
        remembered={remembered}
        onOpenGameData={() => {}}
      />
    );

  it("shows a remembered absence exactly as a fresh one", () => {
    const html = draw(hunterless(), revealing(), memory());

    expect(html).toMatch(
      /0 <button[^>]*data-game-data-entry="equipment:FLOA"[^>]*>floater hide<\/button>/
    );
  });

  it("names the turn a remembered absence was proved, in the hover", () => {
    expect(draw(hunterless(), revealing(), memory())).toContain(
      "A unit with hunting 3 stood here on turn 23, and that report named no floater hide."
    );
  });

  it("shows a remembered presence with its amount", () => {
    const html = draw(
      hunterless(),
      revealing(),
      memory({ amount: 8, name: "floater hides", turn: 25 })
    );

    expect(html).toMatch(
      /8 <button[^>]*data-game-data-entry="equipment:FLOA"[^>]*>floater hides<\/button>/
    );
    expect(html).toContain(
      "A unit with hunting 3 stood here on turn 25, and that report named 8 floater hides."
    );
  });

  it("leaves the line alone when nothing is remembered", () => {
    const html = draw(hunterless(), revealing());

    expect(html).toMatch(
      /<button[^>]*data-game-data-entry="equipment:FLOA"[^>]*>floater hide<\/button>\?/
    );
    expect(html).toMatch(
      /<button[^>]*data-game-data-entry="equipment:MUSH"[^>]*>mushroom<\/button>\?/
    );
  });
});
