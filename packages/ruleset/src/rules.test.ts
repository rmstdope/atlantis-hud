import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMovementRules, RulesetScrapeError } from "./rules";

const RULES_HTML = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/ruleset/neworigins-rules.html", import.meta.url)),
  "utf8"
);

/**
 * These assertions are the rules page's own sentences, not our opinion of Atlantis.
 *
 * The fixture is the page verbatim, so a value changing here means the game changed its rules or
 * the scraper stopped reading them - both of which we want to hear about.
 */
describe("parseMovementRules", () => {
  it("reads the movement point allowance for each mode", () => {
    const rules = parseMovementRules(RULES_HTML);

    // "Walking units have two movement points, riding units have four, and flying units have four."
    expect(rules.movementPoints).toEqual({ walk: 2, ride: 4, fly: 4 });
  });

  it("reads which terrains cost two movement points to enter", () => {
    const rules = parseMovementRules(RULES_HTML);

    // "...the following terrain types take two movement points for riding or walking units to
    // enter: Forest, Mountain, Swamp, Jungle, and Tundra."
    expect(rules.terrainCosts.doubled).toEqual([
      "forest",
      "mountain",
      "swamp",
      "jungle",
      "tundra"
    ]);
    expect(rules.terrainCosts.normal).toBe(1);
    expect(rules.terrainCosts.doubledCost).toBe(2);
  });

  /**
   * The premium is not universal, and the sentence says so: "take two movement points for riding
   * or walking units to enter". Flight is absent from that list, so a flier pays the ordinary cost
   * everywhere. Hardcoding that in the core would be assuming it; reading it is not.
   */
  it("reads which modes of travel the terrain premium applies to", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.terrainCosts.doubledFor).toEqual(["ride", "walk"]);
  });

  it("takes the affected modes from the page rather than assuming them", () => {
    const reworded = RULES_HTML.replace(
      "movement points for riding or\n            walking units to enter:",
      "movement points for walking units to enter:"
    );
    expect(reworded).not.toBe(RULES_HTML);

    expect(parseMovementRules(reworded).terrainCosts.doubledFor).toEqual(["walk"]);
  });

  it("reads the road bonus and its floor", () => {
    const rules = parseMovementRules(RULES_HTML);

    // "If a road in the given direction is connected, units move along that road at half cost to a
    // minimum of 1 movement point."
    expect(rules.road).toEqual({ divisor: 2, minimumCost: 1 });
  });

  it("reads that ocean needs a ship, and that flight may not end over water", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.ocean.requiresShipUnlessFlying).toBe(true);
    expect(rules.ocean.flyingMustEndOnLand).toBe(true);
  });

  /**
   * The planner has to recognise a water hex from the terrain string a report prints, and the name
   * belongs to the game rather than to us. Taking it from the rule's own sentence beats hardcoding
   * "ocean" in the core and hoping every ruleset agrees.
   */
  it("reads which terrain the water rule is about", () => {
    const rules = parseMovementRules(RULES_HTML);

    // "Units may not move through ocean regions without using the SAIL order..."
    expect(rules.ocean.terrain).toBe("ocean");
  });

  /**
   * Asserting "ocean" against a page that says "ocean" proves nothing - a hardcoded constant
   * passes it identically. Renaming the terrain in the page is what separates reading it from
   * assuming it.
   */
  it("takes the water terrain from the page rather than assuming it", () => {
    const renamed = RULES_HTML.replace(
      "Units may not move through ocean regions",
      "Units may not move through water regions"
    );
    expect(renamed).not.toBe(RULES_HTML);

    expect(parseMovementRules(renamed).ocean.terrain).toBe("water");
  });

  it("records the sentence every value came from", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.provenance.movementPoints).toContain("Walking units have two movement points");
    expect(rules.provenance.terrainCosts).toContain("take two movement points");
    expect(rules.provenance.road).toContain("half cost to a minimum of 1 movement point");
    expect(rules.provenance.ocean).toContain("must end their movement on land or else drown");
  });

  /**
   * The whole point of scraping rather than hard-coding: a reworded page must stop the run rather
   * than quietly hand back a stale or invented number.
   */
  it("fails loudly, naming the value, when the movement point sentence is reworded", () => {
    const reworded = RULES_HTML.replace(
      "Walking units have two movement",
      "Walking units have a modest allowance of"
    );
    expect(reworded).not.toBe(RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(RulesetScrapeError);
    expect(() => parseMovementRules(reworded)).toThrowError(/movementPoints/);
  });

  it("fails loudly, naming the value, when the terrain sentence is reworded", () => {
    const reworded = RULES_HTML.replace(
      "walking units to enter: Forest, Mountain, Swamp, Jungle, and Tundra.",
      "walking units, the harder going ones being unlisted here."
    );
    expect(reworded).not.toBe(RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(/terrainCosts/);
  });

  it("fails loudly when the road sentence is reworded", () => {
    const reworded = RULES_HTML.replace(
      "move along that road at half cost to a minimum of 1 movement point.",
      "move along that road rather more easily than otherwise."
    );
    expect(reworded).not.toBe(RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(/road/);
  });

  /**
   * "For a fleet to enter any region only costs one movement point; the cost of two movement
   * points for entering, say, a forest coastal region, does not apply." A fleet ignores the
   * terrain premium entirely, which is why the flat cost is its own rule rather than another entry
   * doubled for a mode.
   */
  it("reads the flat cost a fleet pays to enter any region", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.sailing.flatCost).toBe(1);
  });

  /**
   * "A coastal region is defined as a non-ocean region with at least one adjacent ocean region."
   * Read from the page rather than assumed, the same way the ocean terrain name is.
   */
  it("reads that a fleet may only enter land through a coastal region", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.sailing.landNeedsCoast).toBe(true);
  });

  it("reads which terrain the sailing rule is about, from the ocean rule's own sentence", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.sailing.terrain).toBe("ocean");
  });

  it("records the sentences the sailing rule came from", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.provenance.sailing).toContain("For a fleet to enter any region");
    expect(rules.provenance.sailing).toContain("coastal region is defined");
    expect(rules.provenance.sailing).toContain("one movement point. A coastal region");
  });

  it("fails loudly when the fleet entry-cost sentence is reworded", () => {
    const reworded = RULES_HTML.replace(
      "For a fleet to enter any region\n            only costs one movement point",
      "Fleets pay whatever the region normally costs"
    );
    expect(reworded).not.toBe(RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(/sailing/);
  });

  it("fails loudly when the coastal-region sentence is reworded", () => {
    const reworded = RULES_HTML.replace(
      "A coastal region is defined\n            as a non-ocean region with at least one adjacent ocean region.",
      "Coastal regions are wherever the map maker felt like putting them."
    );
    expect(reworded).not.toBe(RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(/sailing/);
  });
});
