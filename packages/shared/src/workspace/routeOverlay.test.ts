import { describe, expect, it } from "vitest";
import type { Coordinate, RoutePlan, TracedPath } from "@atlantis/core-client";

import { chooseRouteOverlay } from "./routeOverlay";

function at(x: number, y: number, z = 1): Coordinate {
  return { x, y, z };
}

function step(x: number, y: number) {
  return {
    direction: "north" as const,
    to: at(x, y),
    terrain: "plain",
    cost: 1,
    road: false,
    estimated: false
  };
}

const plan: RoutePlan = {
  from: at(7, 53),
  to: at(7, 49),
  mode: "walk",
  steps: [step(7, 51), step(7, 49)],
  totalCost: 2,
  months: [{ month: 1, steps: 2, endsAt: at(7, 49) }],
  order: "MOVE SE"
};

const trace: TracedPath = {
  from: at(7, 53),
  steps: [step(7, 51), step(7, 49), step(7, 47)],
  months: [
    { month: 1, steps: 1, endsAt: at(7, 51) },
    { month: 2, steps: 2, endsAt: at(7, 47) }
  ],
  mode: "walk",
  blockedFrom: null
};

describe("which movement line the map draws", () => {
  it("draws nothing while the movement layer is off", () => {
    expect(
      chooseRouteOverlay({ movementLayerOn: false, plannerArmed: true, plan, trace })
    ).toBeNull();
  });

  it("draws the planner's preview while a plan is showing, all of it solid", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan,
      trace
    });

    expect(overlay).toEqual({
      origin: at(7, 53),
      hexes: [at(7, 51), at(7, 49)],
      solidSteps: 2
    });
  });

  it("draws nothing while the planner is armed but has not answered yet", () => {
    // An armed planner is mid-gesture: showing the old order path under a click that is about to
    // replace it would be showing the answer to the wrong question.
    expect(
      chooseRouteOverlay({ movementLayerOn: true, plannerArmed: true, plan: null, trace })
    ).toBeNull();
  });

  it("draws the selected unit's written order when the planner is idle", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace
    });

    expect(overlay).toEqual({
      origin: at(7, 53),
      hexes: [at(7, 51), at(7, 49), at(7, 47)],
      solidSteps: 1
    });
  });

  it("dots everything from a step the game would refuse, whatever month it falls in", () => {
    // The first month covers one step, but that step is already the sea: nothing is solid.
    const blockedAtOnce = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: { ...trace, blockedFrom: 0 }
    });
    expect(blockedAtOnce?.solidSteps).toBe(0);

    // Blocked beyond the first month's reach: the month split already dots it, and the clamp
    // must not widen the solid line either.
    const blockedLater = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: { ...trace, blockedFrom: 2 }
    });
    expect(blockedLater?.solidSteps).toBe(1);
  });

  it("marks the whole order as later-turn work when the unit's speed is unknown", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: { ...trace, months: [], mode: null }
    });

    expect(overlay?.solidSteps).toBeNull();
  });

  it("draws nothing when there is neither a plan nor an order", () => {
    expect(
      chooseRouteOverlay({ movementLayerOn: true, plannerArmed: false, plan: null, trace: null })
    ).toBeNull();
  });
});
