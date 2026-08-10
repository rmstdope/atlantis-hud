import type { Coordinate, RoutePlan, TracedPath } from "@atlantis/core-client";

/**
 * One movement line for the map, whatever its source.
 *
 * The origin travels separately from the hexes entered because the two are used differently: the
 * line is drawn through all of them, but risk is only ever painted on hexes the unit enters.
 */
export type RouteOverlay = {
  origin: Coordinate;
  /** The hexes entered, in order. */
  hexes: Coordinate[];
  /** How many of them the coming month covers; null when the unit's speed is unknown. */
  solidSteps: number | null;
};

/**
 * Decides which movement line the map draws: the planner's preview or the selected unit's
 * written order, never both.
 *
 * The planner wins while it is in use - armed or already answered - because it is the gesture the
 * player is mid-way through. An armed planner with no answer yet draws nothing at all: showing
 * the old order path under a click that is about to replace it would answer the wrong question.
 */
export function chooseRouteOverlay(input: {
  movementLayerOn: boolean;
  plannerArmed: boolean;
  plan: RoutePlan | null;
  trace: TracedPath | null;
}): RouteOverlay | null {
  if (!input.movementLayerOn) {
    return null;
  }

  if (input.plannerArmed || input.plan) {
    if (!input.plan) {
      return null;
    }
    return {
      origin: input.plan.from,
      hexes: input.plan.steps.map((step) => step.to),
      // The planner only ever proposes what it can stand behind, so its preview stays one solid
      // line exactly as it always was; the month split belongs to written orders.
      solidSteps: input.plan.steps.length
    };
  }

  if (!input.trace) {
    return null;
  }
  // The solid line reaches as far as the coming month does - but never past a step the game
  // would refuse. A walker ordered to sea sees its whole crossing dotted, whatever the month
  // arithmetic says: doubt trumps timing.
  const monthReach = input.trace.months[0]?.steps ?? 0;
  return {
    origin: input.trace.from,
    hexes: input.trace.steps.map((step) => step.to),
    solidSteps:
      input.trace.mode === null
        ? null
        : Math.min(monthReach, input.trace.blockedFrom ?? monthReach)
  };
}
