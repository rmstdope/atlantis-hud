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
    estimated: false,
    overWater: false,
    canal: null
  };
}

const plan: RoutePlan = {
  from: at(7, 53),
  to: at(7, 49),
  mode: "walk",
  steps: [step(7, 51), step(7, 49)],
  totalCost: 2,
  months: [{ month: 1, steps: 2, endsAt: at(7, 49) }],
  order: "MOVE SE",
  loadUnchecked: false
};

const trace: TracedPath = {
  from: at(7, 53),
  steps: [step(7, 51), step(7, 49), step(7, 47)],
  months: [
    { month: 1, steps: 1, endsAt: at(7, 51) },
    { month: 2, steps: 2, endsAt: at(7, 47) }
  ],
  mode: "walk",
  blockedFrom: null,
  passage: null
};

const passage = {
  coordinate: at(7, 53),
  structure: "Shaft [3]",
  stepsAfter: 2,
  terrain: "plain",
  exit: null
};

/** The same passage, proved: it comes out two levels down, with two steps drawn from there. */
const followed = {
  ...passage,
  stepsAfter: 0,
  exit: {
    coordinate: at(30, 30, 3),
    terrain: "mountain",
    cost: 2,
    steps: [step(31, 31), step(32, 32)]
  }
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
      solidSteps: 2,
      passage: null,
      beyond: null
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
      solidSteps: 1,
      passage: null,
      beyond: null
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

describe("a route that ran into an inner passage", () => {
  it("a trace that stopped at a passage carries it", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: { ...trace, steps: [], months: [], passage }
    });

    expect(overlay?.passage).toEqual(passage);
    expect(overlay?.hexes).toEqual([]);
  });

  it("a planner preview never carries a passage", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan,
      trace: { ...trace, passage }
    });

    expect(overlay?.passage).toBeNull();
  });
});

describe("a passage the faction has proved the far side of", () => {
  /** The near half solid to the month's reach, the far half its own leg (`ah-3u7c.2.2`). */
  it("puts the far half in its own leg, never joined to the near one", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: {
        ...trace,
        steps: [step(7, 51)],
        months: [{ month: 1, steps: 4, endsAt: at(32, 32, 3) }],
        passage: followed
      }
    });

    expect(overlay?.hexes).toEqual([at(7, 51)]);
    expect(overlay?.beyond).toEqual({
      origin: at(30, 30, 3),
      hexes: [at(31, 31), at(32, 32)],
      solidSteps: 2
    });
  });

  it("splits the month's reach across the two halves", () => {
    // One near step, then the crossing, then two beyond: a reach of two covers the near step and
    // the crossing and no more, so the far half is wholly dotted.
    const short = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: {
        ...trace,
        steps: [step(7, 51)],
        months: [{ month: 1, steps: 2, endsAt: at(30, 30, 3) }],
        passage: followed
      }
    });
    expect(short?.solidSteps).toBe(1);
    expect(short?.beyond?.solidSteps).toBe(0);

    // A reach of three covers the first step beyond as well.
    const longer = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: {
        ...trace,
        steps: [step(7, 51)],
        months: [{ month: 1, steps: 3, endsAt: at(31, 31) }],
        passage: followed
      }
    });
    expect(longer?.beyond?.solidSteps).toBe(1);
  });

  it("counts a refused step beyond the crossing past the near steps and the crossing", () => {
    // Near step 0, crossing 1, far steps 2 and 3: a refusal at 3 leaves the first far step solid.
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: {
        ...trace,
        steps: [step(7, 51)],
        months: [{ month: 1, steps: 4, endsAt: at(32, 32, 3) }],
        blockedFrom: 3,
        passage: followed
      }
    });

    expect(overlay?.solidSteps).toBe(1);
    expect(overlay?.beyond?.solidSteps).toBe(1);
  });

  it("has no far half for a passage nobody has proved", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan: null,
      trace: { ...trace, steps: [], months: [], passage }
    });

    expect(overlay?.beyond).toBeNull();
  });

  it("never has one on a planner preview", () => {
    const overlay = chooseRouteOverlay({
      movementLayerOn: true,
      plannerArmed: false,
      plan,
      trace: { ...trace, passage: followed }
    });

    expect(overlay?.beyond).toBeNull();
  });
});
