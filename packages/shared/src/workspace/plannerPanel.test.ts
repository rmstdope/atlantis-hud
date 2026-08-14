import type { RoutePlanResponse } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { describeEstimate, describeProblem, routeAsOrder } from "./PlannerPanel";

describe("explaining why there is no route", () => {
  /**
   * A named reason is the whole point of refusing. "No route" tells a player nothing; "the sea at
   * (8,52) is in the way" tells them to find a ship or go round.
   */
  it("names the hex that stopped it", () => {
    expect(describeProblem({ kind: "oceanNeedsShip", coordinate: { x: 8, y: 52, z: 1 } })).toContain(
      "(8,52)"
    );
  });

  it("has something to say about every refusal the core can produce", () => {
    const kinds = [
      "notYourUnit",
      "overloaded",
      "mobilityUnstated",
      "alreadyThere",
      "noKnownRoute",
      "originUnknown"
    ] as const;

    for (const kind of kinds) {
      const sentence = describeProblem({ kind });
      expect(sentence.length, `${kind} should be explained`).toBeGreaterThan(20);
      expect(sentence.endsWith("."), `${kind} should read as a sentence`).toBe(true);
    }
  });

  /** The drowning refusal is about the order, not the journey, and has to say so. */
  it("explains that a drowning refusal is about the single MOVE order", () => {
    const sentence = describeProblem({
      kind: "flightWouldEndOverOcean",
      coordinate: { x: 2, y: 2, z: 1 }
    });

    expect(sentence).toContain("MOVE order");
    expect(sentence).toContain("drowns");
  });

  /** Navigator-approved wording (ah-2vy.2): names both figures so the shortfall is legible. */
  it("names the sailing levels a fleet's crew is short of", () => {
    const sentence = describeProblem({
      kind: "crewCannotSail",
      required: 4,
      available: 1
    });

    expect(sentence).toBe(
      "The crew cannot sail this fleet: it needs 4 levels of sailing, and the units aboard have 1."
    );
  });
});

describe("writing a route as an order", () => {
  const answer = (directions: string[]): RoutePlanResponse => ({
    plan: {
      from: { x: 1, y: 1, z: 1 },
      to: { x: 3, y: 3, z: 1 },
      mode: "walk",
      steps: directions.map((direction, index) => ({
        direction: direction as never,
        to: { x: index, y: index, z: 1 },
        terrain: "plain",
        cost: 1,
        road: false,
        estimated: false
      })),
      totalCost: directions.length,
      months: []
    },
    problem: null,
    risk: null,
    fullyModelled: false
  });

  it("writes the abbreviations the game uses", () => {
    expect(routeAsOrder(answer(["southeast", "southeast"]))).toBe("MOVE SE SE");
    expect(routeAsOrder(answer(["north", "northwest", "south"]))).toBe("MOVE N NW S");
  });

  it("writes SAIL rather than MOVE for a fleet's route", () => {
    const sailPlan = answer(["north"]);
    sailPlan.plan = { ...sailPlan.plan!, mode: "sail" };

    expect(routeAsOrder(sailPlan)).toBe("SAIL N");
  });
});

/**
 * A route through unexplored country is a guess, and a cost that looks like every other cost would
 * be read as a fact. The panel has to say how much of it was invented.
 */
describe("saying how much of a route is guesswork", () => {
  const step = (estimated: boolean) => ({
    direction: "southeast" as never,
    to: { x: 1, y: 1, z: 1 },
    terrain: "plain",
    cost: 1,
    road: false,
    estimated
  });

  it("says nothing at all about a route the reports describe in full", () => {
    expect(describeEstimate([step(false), step(false)])).toBeNull();
  });

  it("counts the unexplored hexes and warns what is unknown about them", () => {
    const sentence = describeEstimate([step(false), step(true), step(true)]);

    expect(sentence).toContain("2");
    expect(sentence).toContain("unexplored");
    expect(sentence?.endsWith(".")).toBe(true);
  });

  it("reads as one hex rather than as 1 hexes", () => {
    expect(describeEstimate([step(true)])).toContain("1 of these hexes is unexplored");
  });
});
