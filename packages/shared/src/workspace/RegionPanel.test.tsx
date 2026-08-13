import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { OrderDiagnostic } from "@atlantis/core-client";
import { SURFACE, type HexNode } from "../hexMapModel";
import { RegionPanel } from "./RegionPanel";
import { resetWorkspaceStore } from "../workspaceStore";

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
  region: {
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
    entertainment: 200,
    products: [],
    wanted: [],
    forSale: [],
    exits: [],
    structures: [],
    units: []
  }
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
  renderToStaticMarkup(<RegionPanel hex={HEX} problems={problems} />);

describe("the region panel's problems toggle", () => {
  beforeEach(resetWorkspaceStore);

  it("offers no problems toggle on a hex with nothing wrong", () => {
    const markup = draw([]);

    expect(markup).not.toContain("region-problems-toggle");
  });

  it("puts a problems toggle in the header, with the count", () => {
    const markup = draw(PROBLEMS);

    expect(markup).toContain("region-problems-toggle");
    expect(markup).toContain("Problems");
    expect(markup).toContain("3");
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*data-testid="region-problems-toggle"/);
  });

  it("shows the problems by default", () => {
    const markup = draw(PROBLEMS);

    expect(markup).toContain("region-problems");
  });
});
