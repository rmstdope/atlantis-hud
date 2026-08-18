import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RegionPreview, ReportRegion, ReportUnit } from "@atlantis/core-client";
import { aReportRegion, aReportUnit } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { UnitTableDock } from "./UnitTableDock";

/**
 * A hex's units pane, as markup.
 *
 * The repository has no jsdom, so scrolling and pointer behaviour are the smoke suite's job; what
 * is checkable here is what the pane says when it has nothing to show, which is the part ah-o86
 * changed: a stale hex's empty list must not read as a genuinely empty hex.
 */
const region = (overrides: Partial<ReportRegion> = {}): ReportRegion =>
  aReportRegion({ regionId: "1:6,52", coordinate: { x: 6, y: 52, z: 1 }, terrain: "tundra", province: "Farside", ...overrides });

function hex(overrides: Partial<HexNode> = {}): HexNode {
  return {
    regionId: "1:6,52",
    coordinate: { x: 6, y: 52, z: 1 },
    terrain: "tundra",
    province: "Farside",
    label: "tundra (6,52) in Farside",
    knowledge: "current",
    lastSeenTurn: 42,
    ageInTurns: 0,
    settlementName: null,
    region: region(),
    ownUnitCount: 0,
    foreignUnitCount: 0,
    ...overrides
  };
}

function draw(node: HexNode | null, preview: RegionPreview | null = null): string {
  return renderToStaticMarkup(<UnitTableDock hex={node} preview={preview} />);
}

const unit = (overrides: Partial<ReportUnit> = {}): ReportUnit =>
  aReportUnit({ unitId: "1", name: "Scout", regionId: "1:6,52", factionId: "1", factionName: "My Faction", ...overrides });

describe("the units pane on an empty hex", () => {
  it("a stale hex explains its empty list instead of claiming an empty hex", () => {
    const markup = draw(hex({ knowledge: "stale", lastSeenTurn: 21, region: region({ units: [] }) }));

    expect(markup).toContain("Not seen since turn 21 — no current unit information.");
    expect(markup).not.toContain("No units reported in this hex.");
  });

  it("a stale hex's header names the ground but counts nothing", () => {
    const markup = draw(hex({ knowledge: "stale", lastSeenTurn: 21, region: region({ units: [] }) }));

    // The hint text itself, wherever the header happens to wrap it: everything from the em dash up
    // to the next tag boundary. Asserted this way rather than against a specific element's classes,
    // so a harmless markup or styling change cannot break this test over text that stayed right.
    const hint = /—[^<]*/.exec(markup)?.[0];

    expect(hint).toBe("— tundra (6,52)");
  });

  it("an empty current hex keeps today's line", () => {
    const markup = draw(hex({ knowledge: "current", lastSeenTurn: 42, region: region({ units: [] }) }));

    expect(markup).toContain("No units reported in this hex.");
    expect(markup).not.toContain("Not seen since turn");
  });
});

describe("the dock stops sizing itself", () => {
  it("the scroller carries no height of its own", () => {
    const markup = draw(
      hex({
        knowledge: "current",
        lastSeenTurn: 42,
        region: region({ units: [unit({ unitId: "1" }), unit({ unitId: "2" })] })
      })
    );

    // The scroller's own class carries no style attribute at all now - the slot around it owns
    // the height. Rows still carry their own fixed "height:22px", which is unrelated. Matched by
    // the classes it must carry rather than the whole attribute value, so a harmless class added
    // later cannot break this over behaviour that still holds.
    const scroller = /<div[^>]*class="[^"]*overflow-y-scroll[^"]*"[^>]*>/.exec(markup)?.[0];
    expect(scroller).toBeDefined();
    expect(scroller).toContain("h-full");
    expect(scroller).toContain("overflow-x-hidden");
    expect(scroller).not.toContain("style=");
  });

  it("an empty hex is a message, not a reserved box", () => {
    const markup = draw(hex({ knowledge: "current", lastSeenTurn: 42, region: region({ units: [] }) }));

    expect(markup).toContain("No units reported in this hex.");
    expect(markup).not.toContain('style="height:');
  });
});


describe("a unit carried away by a sailing fleet", () => {
  const carried = (aboard: string | null, departingTo: string | null): RegionPreview => ({
    regionId: "1:6,52",
    units: [
      {
        unit: unit({ unitId: "901", name: "Passengers", structureId: "329" }),
        status: "departing",
        changes: [],
        arrivingFrom: null,
        departingTo,
        aboard
      }
    ]
  });

  it("names the fleet that takes it, beside where it is bound", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "901", name: "Passengers", structureId: "329" })] }) }),
      carried("Wavecrest [329]", "1:7,53")
    );

    expect(markup).toContain("→ 1:7,53");
    expect(markup).toContain("aboard Wavecrest [329]");
  });

  it("still names the fleet when the ship's destination cannot be named", () => {
    const markup = draw(
      hex({ region: region({ units: [unit({ unitId: "901", name: "Passengers", structureId: "329" })] }) }),
      carried("Wavecrest [329]", null)
    );

    expect(markup).toContain("→ …");
    expect(markup).toContain("aboard Wavecrest [329]");
  });
});

describe("the structure column", () => {
  const WAVECREST = {
    structureId: "329",
    name: "Wavecrest",
    kind: "Longship",
    description: null,
    needs: null
  };

  const inStructures = (units: ReportUnit[]) =>
    hex({ region: region({ structures: [WAVECREST], units }) });

  it("names the structure a unit stands in, not just its number", () => {
    const markup = draw(inStructures([unit({ unitId: "901", name: "Passengers", structureId: "329" })]));

    expect(markup).toContain("Wavecrest [329] · Longship");
  });

  it("keeps the bare number when the region never described the structure", () => {
    const markup = draw(inStructures([unit({ unitId: "901", name: "Passengers", structureId: "77" })]));

    expect(markup).toContain("[77]");
    expect(markup).not.toContain("Wavecrest [77]");
  });

  it("leaves the cell empty for a unit standing in the open", () => {
    const markup = draw(inStructures([unit({ unitId: "902", name: "Scout", structureId: null })]));

    expect(markup).not.toContain("Wavecrest");
    // The structure cell is the row's last, and it renders with nothing in it at all.
    expect(markup).toMatch(/<td[^>]*><\/td><\/tr>/);
  });

  it("the tooltip gives the whole label, and what the orders changed beneath it", () => {
    const markup = draw(
      inStructures([unit({ unitId: "901", name: "Passengers", structureId: "329" })]),
      {
        regionId: "1:6,52",
        units: [
          {
            unit: unit({ unitId: "901", name: "Passengers", structureId: "329" }),
            status: "present",
            changes: [{ field: "structureId", original: "" }],
            arrivingFrom: null,
            departingTo: null,
            aboard: null
          }
        ]
      }
    );

    expect(markup).toContain("Wavecrest [329] · Longship\n");
    expect(markup).toMatch(/title="Wavecrest \[329\] · Longship\n[^"]/);
  });
});
