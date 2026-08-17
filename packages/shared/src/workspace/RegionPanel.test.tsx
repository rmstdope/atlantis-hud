import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { CoreClient, MapLevel, OpenedGame, OrderDiagnostic } from "@atlantis/core-client";
import { aReportRegion } from "@atlantis/core-client";
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
