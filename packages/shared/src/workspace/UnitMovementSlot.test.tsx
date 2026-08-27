import { afterEach, describe, expect, it } from "vitest";
import { aReportUnit, type RoutePlanResponse } from "@atlantis/core-client";
import { renderWithStoreState, restoreStoresForTest } from "../testing/storeState";
import { SURFACE, type HexNode } from "../hexMapModel";
import { useWorkspaceStore } from "../workspaceStore";
import { UnitMovementSlot, type SlotPlanner } from "./UnitMovementSlot";

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

const UNIT = aReportUnit({ own: true });

const ROUTE: RoutePlanResponse = {
  plan: {
    from: { x: 7, y: 53, z: SURFACE },
    to: { x: 7, y: 51, z: SURFACE },
    mode: "walk",
    steps: [
      {
        direction: "north",
        to: { x: 7, y: 51, z: SURFACE },
        terrain: "plain",
        cost: 1,
        road: false,
        estimated: false
      }
    ],
    totalCost: 1,
    months: [{ month: 1, steps: 1, endsAt: { x: 7, y: 51, z: SURFACE } }],
    order: "MOVE N"
  },
  problem: null,
  risk: null,
  fullyModelled: true
};

const PLANNER: SlotPlanner = {
  armed: false,
  busy: false,
  answer: ROUTE,
  onArm: () => {},
  onClear: () => {},
  onApply: () => {}
};

/**
 * A static render reads the store's `getInitialState()`, so which tab is showing has to be mirrored
 * onto it - which is all `renderWithStoreState` does (`testing/README.md`).
 */
const draw = (
  planner: SlotPlanner | null,
  tab: "unit" | "movement" | null = null
): string =>
  renderWithStoreState(
    <UnitMovementSlot unit={UNIT} hex={HEX} preview={null} gameData={null} magicTree={null} planner={planner} />,
    useWorkspaceStore,
    { unitSlotTab: tab }
  );

afterEach(restoreStoresForTest);

describe("the shared Unit/Movement slot", () => {
  it("draws the unit's panel and no tab strip when the planner is off", () => {
    const markup = draw(null);

    expect(markup).toContain('data-testid="panel-unit"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("slot-tab-movement");
    expect(markup).not.toContain('data-testid="planner-arm"');
    expect(markup).toContain(UNIT.name);
  });

  it("draws two tabs and the unit's panel when the planner is on and nothing is planned", () => {
    const markup = draw({ ...PLANNER, answer: null });

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('data-testid="slot-tab-unit"');
    expect(markup).toContain('data-testid="slot-tab-movement"');
    expect(markup).toContain('data-testid="planner-arm"');
    expect(markup).toContain(UNIT.name);
    expect(markup).not.toContain('data-testid="panel-planner"');
  });

  it("draws the movement panel once a destination has been picked", () => {
    const markup = draw(PLANNER, "movement");

    expect(markup).toContain('data-testid="panel-planner"');
    expect(markup).toContain('data-testid="planner-apply"');
    expect(markup).toContain("MOVE N");
  });

  it("does not draw the movement panel while the unit tab is showing", () => {
    const markup = draw(PLANNER, "unit");

    expect(markup).not.toContain('data-testid="panel-planner"');
    expect(markup).not.toContain('data-testid="planner-apply"');
    expect(markup).toContain(UNIT.name);
  });

  it("gives the movement panel a scroller of its own", () => {
    // The Apply row is pinned below it; two nested scrollers would scroll the button away, which
    // is the very thing this bead is fixing. Where it sits is a smoke assertion.
    const markup = draw(PLANNER, "movement");
    const scroller = /<div[^>]*data-testid="planner-scroll"[^>]*>/.exec(markup)?.[0] ?? "";

    expect(scroller).toContain("overflow-y-auto");
  });

  it("keeps the unit's own name in the title bar's place when the planner takes the header", () => {
    // `CollapsiblePanel`'s hint has no room beside a tab strip, so the Unit tab carries it instead.
    const markup = draw(PLANNER, "unit");

    expect(markup).toContain(`(${UNIT.unitId})`);
  });

  it("puts the dot on the movement tab whenever a route stands, whichever tab is showing", () => {
    expect(draw(PLANNER, "unit")).toContain('aria-label="Movement, a route is planned"');
    expect(draw({ ...PLANNER, answer: null }, "unit")).not.toContain("a route is planned");
  });

  it("keeps the one fold control the smoke suite's foldPanel looks for", () => {
    const markup = draw(PLANNER, "movement");

    expect((markup.match(/aria-expanded=/g) ?? []).length).toBe(1);
  });
});
