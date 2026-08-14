import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportRegion, ReportUnit } from "@atlantis/core-client";
import type { HexNode } from "../hexMapModel";
import { resetSettingsStore, useSettingsStore } from "../settingsStore";
import { ROW_HEIGHT } from "../unitTable";
import { UnitTableDock } from "./UnitTableDock";

/**
 * `renderToStaticMarkup` runs with no `window`, so React treats it as a server render and the
 * store's React binding reads `getInitialState()` rather than `getState()` - a snapshot frozen at
 * module load, which a test's `setState()` never reaches. The store itself is unaffected (it is
 * the plain vanilla store other tests read directly); only its React hook is mocked here, to read
 * the live state instead, so a setting changed for one of these tests is what the render sees.
 */
vi.mock("../settingsStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../settingsStore")>();
  return {
    ...actual,
    useSettingsStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useSettingsStore.getState>) => unknown) =>
        selector(actual.useSettingsStore.getState()),
      actual.useSettingsStore
    )
  };
});

/**
 * A hex's units pane, as markup.
 *
 * The repository has no jsdom, so scrolling and pointer behaviour are the smoke suite's job; what
 * is checkable here is what the pane says when it has nothing to show, which is the part ah-o86
 * changed: a stale hex's empty list must not read as a genuinely empty hex.
 */
function region(overrides: Partial<ReportRegion> = {}): ReportRegion {
  return {
    regionId: "1:6,52",
    coordinate: { x: 6, y: 52, z: 1 },
    terrain: "tundra",
    province: "Farside",
    settlement: null,
    population: null,
    race: null,
    taxBase: null,
    wages: null,
    maxWages: null,
    entertainment: null,
    products: [],
    wanted: [],
    forSale: [],
    exits: [],
    structures: [],
    units: [],
    ...overrides
  };
}

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

function unit(overrides: Partial<ReportUnit> = {}): ReportUnit {
  return {
    unitId: "1",
    name: "Scout",
    regionId: "1:6,52",
    factionId: "1",
    factionName: "My Faction",
    own: true,
    onGuard: false,
    flags: [],
    items: [],
    skills: [],
    men: 1,
    menEstimated: false,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null,
    ...overrides
  };
}

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

/**
 * Fixed pane size: the pane reserves the same height whatever the hex holds, instead of hugging a
 * short list. `head` is never measured under `renderToStaticMarkup` - there is no layout, no refs
 * resolved - so the reserved height here is always the fallback arithmetic: one row for the header
 * plus the configured limit's worth of rows.
 */
describe("fixed pane size", () => {
  afterEach(() => {
    resetSettingsStore();
  });

  it("a fixed-size pane reserves its rows on an empty hex", () => {
    useSettingsStore.setState({ unitListFixedSize: true, unitListLimit: 12 });

    const markup = draw(hex({ knowledge: "current", lastSeenTurn: 42, region: region({ units: [] }) }));

    expect(markup).toContain("No units reported in this hex.");
    expect(markup).toContain(`style="height:${ROW_HEIGHT + 12 * ROW_HEIGHT}px"`);
  });

  it("a fixed-size pane reserves its rows on a stale hex", () => {
    useSettingsStore.setState({ unitListFixedSize: true, unitListLimit: 12 });

    const markup = draw(
      hex({ knowledge: "stale", lastSeenTurn: 21, region: region({ units: [] }) })
    );

    expect(markup).toContain("Not seen since turn 21 — no current unit information.");
    expect(markup).toContain(`style="height:${ROW_HEIGHT + 12 * ROW_HEIGHT}px"`);
  });

  it("the default pane still hugs a short list", () => {
    useSettingsStore.setState({ unitListFixedSize: false, unitListLimit: 12 });

    // Two units, well under the limit: with the option off this hits the scroller branch (not
    // the Absent one), which is what carries the maxHeight ceiling.
    const markup = draw(
      hex({
        knowledge: "current",
        lastSeenTurn: 42,
        region: region({ units: [unit({ unitId: "1" }), unit({ unitId: "2" })] })
      })
    );

    // Rows have their own bare "height:22px" style, and "max-height:" itself contains the
    // substring "height:", so neither a plain substring check nor an opening-quote anchor can
    // tell a fixed reservation from ordinary row markup. The reserved figure (286px) can never
    // collide with a row's fixed 22px, so checking for it by value is unambiguous.
    expect(markup).not.toContain(`height:${ROW_HEIGHT + 12 * ROW_HEIGHT}px`);
    expect(markup).toContain(`max-height:${12 * ROW_HEIGHT}px`);
  });
});

