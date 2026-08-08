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
});
