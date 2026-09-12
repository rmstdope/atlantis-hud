import { describe, expect, it } from "vitest";
import { describeEstimate, describeProblem, describeStep } from "./PlannerPanel";

describe("explaining why there is no route", () => {
  /**
   * A named reason is the whole point of refusing. "No route" tells a player nothing; "the sea at
   * (8,52) is in the way" tells them to find a ship or go round.
   */
  it("names the hex that stopped it", () => {
    expect(
      describeProblem({
        kind: "oceanNeedsShip",
        coordinate: { x: 8, y: 52, z: 1 },
        terrain: "ocean"
      })
    ).toContain("(8,52)");
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
      coordinate: { x: 2, y: 2, z: 1 },
      terrain: "ocean"
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

  /**
   * Every refusal names the hex by the terrain the report gave it, so a world with a second kind of
   * water names it without a code change. The sea keeps the words players already read.
   */
  it("names a lake a lake", () => {
    expect(
      describeProblem({
        kind: "oceanNeedsShip",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "lake"
      })
    ).toBe("The lake at (2,2) is in the way, and crossing it needs a ship.");

    expect(
      describeProblem({
        kind: "destinationNeedsShip",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "lake"
      })
    ).toBe("(2,2) is a lake, and this unit would need a ship to be there.");
  });

  it("names the sea the sea", () => {
    expect(
      describeProblem({
        kind: "oceanNeedsShip",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "ocean"
      })
    ).toBe("The sea at (2,2) is in the way, and crossing it needs a ship.");

    expect(
      describeProblem({
        kind: "destinationNeedsShip",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "ocean"
      })
    ).toBe("(2,2) is ocean, and this unit would need a ship to be there.");
  });

  it("says a flier would drown over the named water", () => {
    expect(
      describeProblem({
        kind: "flightWouldEndOverOcean",
        coordinate: { x: 3, y: 3, z: 1 },
        terrain: "lake"
      })
    ).toBe(
      "A single MOVE order would leave this unit over the lake at (3,3) when the month ran out, and a unit that ends a turn over water drowns."
    );
  });

  it("names the sailing rule, not the map, when a coastal hop is refused", () => {
    const sentence = describeProblem({
      kind: "sailNeedsOcean",
      from: { x: 2, y: 2, z: 1 },
      fromTerrain: "forest",
      to: { x: 3, y: 3, z: 1 },
      toTerrain: "forest"
    });

    expect(sentence).toBe(
      "A fleet may only sail where one end of the step is water, so it cannot go from forest (2,2) straight to forest (3,3)."
    );
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
    estimated,
    overWater: false
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

  /** An unexplored hex may turn out to be any water, not only sea. */
  it("warns that an unexplored hex may be water of any kind", () => {
    expect(describeEstimate([step(true), step(true)])).toBe(
      "2 of these hexes are unexplored: the terrain, the cost and whatever stands there are guesses, and one of them may be water."
    );
  });
});

/**
 * A water hex is a flier's news - it drowns if a month ends on one - and no news at all for a
 * fleet, which is on water nearly all the way. So the mode decides whether a wet step says so.
 */
describe("printing one route step", () => {
  const wet = {
    direction: "southeast" as never,
    to: { x: 3, y: 3, z: 1 },
    terrain: "lake",
    cost: 1,
    road: false,
    estimated: false,
    overWater: true
  };

  it("marks a flier's water step and not a fleet's", () => {
    expect(describeStep(wet, "fly")).toBe("lake (3,3) · 1 · over water");
    expect(describeStep({ ...wet, to: { x: 2, y: 2, z: 1 } }, "sail")).toBe("lake (2,2) · 1");
  });

  it("appends the mark after a road, and says nothing on a dry step", () => {
    expect(describeStep({ ...wet, road: true }, "fly")).toBe("lake (3,3) · 1 · road · over water");
    expect(
      describeStep({ ...wet, terrain: "plain", overWater: false, road: false }, "fly")
    ).toBe("plain (3,3) · 1");
  });

  it("names an unexplored hex as unexplored rather than by the terrain it was taken for", () => {
    expect(describeStep({ ...wet, estimated: true, overWater: false }, "fly")).toBe(
      "unexplored (3,3) · 1 · estimated"
    );
  });
});
