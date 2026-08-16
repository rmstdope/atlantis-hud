import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportRegion, ReportUnit } from "@atlantis/core-client";
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

function draw(node: HexNode | null): string {
  return renderToStaticMarkup(<UnitTableDock hex={node} />);
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

