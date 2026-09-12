import { describe, expect, it } from "vitest";
import { describeEstimate, describeLoadCheck, describeProblem, describeStep } from "./PlannerPanel";

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

  /**
   * Core refuses a fleet an inland hex through the same variant, and that hex is dry - so the
   * terrain it hands over is the world's own water rather than the hex's, and this is the sentence
   * that would read as a contradiction if it were not.
   */
  it("never calls a dry hex the water in the way", () => {
    expect(
      describeProblem({
        kind: "oceanNeedsShip",
        coordinate: { x: 3, y: 3, z: 1 },
        terrain: "ocean"
      })
    ).toBe("The sea at (3,3) is in the way, and crossing it needs a ship.");
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

    // The water refusals carry a terrain, so they cannot be built from a bare kind - but they are
    // part of "every refusal the core can produce" and this test would overclaim without them.
    for (const kind of [
      "oceanNeedsShip",
      "destinationNeedsShip",
      "flightWouldEndOverOcean",
      "isthmusNeedsCanal"
    ] as const) {
      const sentence = describeProblem({
        kind,
        coordinate: { x: 1, y: 1, z: 1 },
        terrain: "lake"
      });
      expect(sentence.length, `${kind} should be explained`).toBeGreaterThan(20);
      expect(sentence.endsWith("."), `${kind} should read as a sentence`).toBe(true);
    }

    // The overload refusal carries numbers and an optional second fault, so both of its shapes are
    // asked for here: it is part of "every refusal the core can produce" too.
    for (const crew of [null, { required: 4, available: 2 }] as const) {
      const sentence = describeProblem({
        kind: "fleetOverloaded",
        load: 210,
        capacity: 150,
        crew
      });
      expect(sentence.length, "fleetOverloaded should be explained").toBeGreaterThan(20);
      expect(sentence.endsWith("."), "fleetOverloaded should read as a sentence").toBe(true);
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
   * Navigator-approved wording (ah-co6w): the weight aboard first, then the hull's capacity, then
   * what follows from it.
   */
  it("names the load and the capacity it beats", () => {
    expect(
      describeProblem({ kind: "fleetOverloaded", load: 210, capacity: 150, crew: null })
    ).toBe(
      "This fleet is carrying more than it can hold: 210 aboard on a capacity of 150, so it will not sail."
    );
  });

  /**
   * One sentence for both faults, so a player does not shift cargo, re-plan, and meet a second
   * refusal nobody mentioned (ah-co6w).
   */
  it("names both faults in one sentence", () => {
    expect(
      describeProblem({
        kind: "fleetOverloaded",
        load: 210,
        capacity: 150,
        crew: { required: 4, available: 2 }
      })
    ).toBe(
      "This fleet will not sail: it is carrying 210 on a capacity of 150, and the units aboard have 2 levels of sailing where it needs 4."
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

  /**
   * `rules/movement_sailing`: "Ships may not sail through single hex land masses and must leave via
   * the same side they entered or a side adjacent to that one." The sentence names the rule and the
   * hex it stopped at, and says nothing about canals.
   */
  it("names the rule and the hex it stopped at", () => {
    expect(
      describeProblem({
        kind: "isthmusNeedsCanal",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "plain"
      })
    ).toBe(
      "A fleet must leave a land hex by the side it entered or one beside it, so it cannot sail straight through plain (2,2)."
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
    overWater: false,
    canal: null
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
    overWater: true,
    canal: null
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

  /**
   * The building's own name carries its price - the suffix sits where `· road` sits. A step with no
   * canal is unchanged from today.
   */
  it("names the canal on a step through it", () => {
    const dry = { ...wet, terrain: "plain", to: { x: 2, y: 2, z: 1 }, overWater: false };

    expect(describeStep({ ...dry, cost: 2, canal: "Canal" }, "sail")).toBe("plain (2,2) · 2 · Canal");
    expect(describeStep({ ...dry, cost: 1, canal: "Mystic Canal" }, "sail")).toBe(
      "plain (2,2) · 1 · Mystic Canal"
    );
    expect(describeStep(dry, "sail")).toBe("plain (2,2) · 1");
  });
});

describe("saying when the sailing weight check could not be made", () => {
  const route = {
    from: { x: 1, y: 1, z: 1 },
    to: { x: 2, y: 2, z: 1 },
    mode: "sail" as const,
    steps: [],
    totalCost: 1,
    months: [{ month: 1, steps: 1, endsAt: { x: 2, y: 2, z: 1 } }],
    order: "SAIL SE",
    loadUnchecked: false
  };

  /**
   * A route the panel is sure about and one it could not check must not look alike; that is the
   * silent confidence this sentence exists to remove (ah-co6w).
   */
  it("says when the weight check could not be made", () => {
    expect(describeLoadCheck({ ...route, loadUnchecked: true })).toBe(
      "The report doesn't say how much this fleet is carrying, so whether it is light enough to sail has not been checked."
    );
  });

  it("says nothing when the check was made", () => {
    expect(describeLoadCheck(route)).toBeNull();
  });
});

describe("explaining why the water refuses a swimmer", () => {
  it("names the numbers rather than a ship when a swimmer carries too much", () => {
    expect(
      describeProblem({
        kind: "swimLoadTooHeavy",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "ocean",
        capacity: 20,
        load: 40,
        destination: false
      })
    ).toBe("The sea at (2,2) is in the way, and this unit cannot swim carrying 40 when it can bear 20.");
  });

  it("names the hex the player clicked when that is the one refusing", () => {
    expect(
      describeProblem({
        kind: "swimLoadTooHeavy",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "ocean",
        capacity: 20,
        load: 40,
        destination: true
      })
    ).toBe("(2,2) is ocean, and this unit cannot swim carrying 40 when it can bear 20.");
  });

  it("says a swimmer with no sea creatures keeps to coastal water", () => {
    expect(
      describeProblem({
        kind: "deepWaterNeedsSeaCreatures",
        coordinate: { x: 3, y: 3, z: 1 },
        terrain: "ocean",
        borne: 0,
        load: 40,
        destination: false
      })
    ).toBe("The deep sea at (3,3) is in the way, and this unit can swim only in coastal water.");
  });

  it("says how much sea creatures that fall short can bear", () => {
    expect(
      describeProblem({
        kind: "deepWaterNeedsSeaCreatures",
        coordinate: { x: 3, y: 3, z: 1 },
        terrain: "ocean",
        borne: 20,
        load: 40,
        destination: true
      })
    ).toBe("(3,3) is deep sea, and this unit's sea creatures can bear 20 of its 40.");
  });

  it("refuses water whose depth cannot be told rather than guessing", () => {
    expect(
      describeProblem({
        kind: "waterDepthUnknown",
        coordinate: { x: 3, y: 3, z: 1 },
        terrain: "ocean"
      })
    ).toBe(
      "There is no telling whether the sea at (3,3) is deep, and this unit can swim only in coastal water."
    );
  });

  it("says when the report is silent about swimming capacity", () => {
    expect(
      describeProblem({
        kind: "swimCapacityUnstated",
        coordinate: { x: 2, y: 2, z: 1 },
        terrain: "ocean"
      })
    ).toBe(
      "The report does not say how much this unit can carry while swimming, so there is no telling whether it can enter the sea at (2,2)."
    );
  });
});

describe("marking a wet step", () => {
  const wet = {
    direction: "southeast" as const,
    to: { x: 2, y: 2, z: 1 },
    terrain: "ocean",
    cost: 1,
    road: false,
    estimated: false,
    overWater: true,
    canal: null
  };

  it("says a walker in the water is swimming", () => {
    expect(describeStep(wet, "walk")).toBe("ocean (2,2) · 1 · swimming");
  });

  it("keeps the flier over the water", () => {
    expect(describeStep(wet, "fly")).toBe("ocean (2,2) · 1 · over water");
  });

  it("says nothing of a fleet, which is on water nearly all the way", () => {
    expect(describeStep(wet, "sail")).toBe("ocean (2,2) · 1");
  });
});
describe("describeProblem for a passenger on a fleet", () => {
  it("names the owner that can set the course", () => {
    expect(
      describeProblem({
        kind: "notFleetOwner",
        unit: "Marines (902)",
        fleet: "Longship [329]",
        owner: "Sea Rovers (900)"
      })
    ).toBe(
      "Marines (902) is a passenger on Longship [329]. Only its owner, Sea Rovers (900), can set its course."
    );
  });
});
