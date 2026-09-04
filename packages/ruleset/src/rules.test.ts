import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseFoodMaintenance,
  parseMovementRules,
  parseRegionResources,
  parseWeatherGap,
  RulesetScrapeError
} from "./rules";

const RULES_HTML = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/ruleset/neworigins-rules.html", import.meta.url)),
  "utf8"
);

const ARCANUM_RULES_HTML = readFileSync(
  fileURLToPath(
    new URL("../../../tests/fixtures/ruleset/newage-arcanum-rules.html", import.meta.url)
  ),
  "utf8"
);

const TRIDENT_RULES_HTML = readFileSync(
  fileURLToPath(
    new URL("../../../tests/fixtures/ruleset/newage-trident-rules.html", import.meta.url)
  ),
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
    expect(rules.terrainCosts.premiums).toEqual({
      forest: 2,
      mountain: 2,
      swamp: 2,
      jungle: 2,
      tundra: 2
    });
    expect(rules.terrainCosts.normal).toBe(1);
  });

  /**
   * The premium is not universal, and the sentence says so: "take two movement points for riding
   * or walking units to enter". Flight is absent from that list, so a flier pays the ordinary cost
   * everywhere. Hardcoding that in the core would be assuming it; reading it is not.
   */
  it("reads which modes of travel the terrain premium applies to", () => {
    const rules = parseMovementRules(RULES_HTML);

    expect(rules.terrainCosts.premiumFor).toEqual(["ride", "walk"]);
  });

  it("takes the affected modes from the page rather than assuming them", () => {
    const reworded = RULES_HTML.replace(
      "movement points for riding or\n            walking units to enter:",
      "movement points for walking units to enter:"
    );
    expect(reworded).not.toBe(RULES_HTML);

    expect(parseMovementRules(reworded).terrainCosts.premiumFor).toEqual(["walk"]);
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

  /**
   * Atlantis New Age states two tiers in one sentence: "…which cost a riding or walking unit more
   * to enter: 2 movement points for forest, mountain, hill, swamp, jungle, tundra, cavern,
   * underforest, tunnels, grotto, deepforest and chasm; 4 movement points for volcano." A shape
   * carrying one premium cannot hold a volcano at four.
   */
  it("reads a tiered terrain sentence, pricing a volcano above a forest", () => {
    const rules = parseMovementRules(ARCANUM_RULES_HTML);

    expect(rules.terrainCosts.normal).toBe(1);
    expect(rules.terrainCosts.premiums).toEqual({
      forest: 2,
      mountain: 2,
      hill: 2,
      swamp: 2,
      jungle: 2,
      tundra: 2,
      cavern: 2,
      underforest: 2,
      tunnels: 2,
      grotto: 2,
      deepforest: 2,
      chasm: 2,
      volcano: 4
    });
    expect(rules.terrainCosts.premiumFor).toEqual(["ride", "walk"]);
    expect(rules.provenance.terrainCosts).toContain("4 movement points for volcano");
    // The sentence that follows is about weather, which this ruleset shape does not model. A
    // provenance string that swallowed it would be quoting a rule nothing here reads.
    expect(rules.provenance.terrainCosts).not.toContain("Weather is reported");
  });

  /**
   * What made this bead small: five of the six movement sentences are word for word what the New
   * Origins page says, so only the terrain one needed a second wording. A later reword of any of
   * them should fail here.
   */
  it("reads the other five movement sentences off a New Age page unchanged", () => {
    const rules = parseMovementRules(ARCANUM_RULES_HTML);

    expect(rules.movementPoints).toEqual({ walk: 2, ride: 4, fly: 4 });
    expect(rules.road).toEqual({ divisor: 2, minimumCost: 1 });
    expect(rules.ocean.terrain).toBe("ocean");
    expect(rules.sailing.flatCost).toBe(1);
    expect(rules.sailing.landNeedsCoast).toBe(true);
  });

  /**
   * A tier that does not parse must stop the run. Skipping it is a volcano silently costing one,
   * which is the failure this whole shape exists to prevent.
   */
  it("fails loudly when a tier clause is not a cost and a list", () => {
    // The page wraps its lines, so the clause is matched as the fixture actually spells it.
    const reworded = ARCANUM_RULES_HTML.replace(
      "chasm; 4\n      movement points for volcano.",
      "chasm; volcano is expensive."
    );
    expect(reworded).not.toBe(ARCANUM_RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(RulesetScrapeError);
    expect(() => parseMovementRules(reworded)).toThrowError(/volcano is expensive/);
  });

  /** A different world of the same variant: what proves the parser reads a wording, not a page. */
  it("reads the Trident world's rules page the same way", () => {
    expect(parseMovementRules(TRIDENT_RULES_HTML).terrainCosts).toEqual(
      parseMovementRules(ARCANUM_RULES_HTML).terrainCosts
    );
  });

  /**
   * A terrain named in two tiers at two prices cannot happen on either page today; it can only
   * mean the sentence was misread, and reading it wrongly silently is the failure to avoid.
   */
  it("fails loudly when one terrain is priced in two tiers at once", () => {
    const reworded = ARCANUM_RULES_HTML.replace(
      "movement points for volcano.",
      "movement points for volcano and forest."
    );
    expect(reworded).not.toBe(ARCANUM_RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(RulesetScrapeError);
    expect(() => parseMovementRules(reworded)).toThrowError(/forest is priced at both 2 and 4/);
  });

  /**
   * A tier priced with a number word the scraper has not been taught must point at the one-line
   * fix, not at the sentence's grammar, which is a different repair entirely.
   */
  it("names NUMBER_WORDS when a tier is priced with a word it does not know", () => {
    const reworded = ARCANUM_RULES_HTML.replace("chasm; 4\n", "chasm; fifteen\n");
    expect(reworded).not.toBe(ARCANUM_RULES_HTML);

    expect(() => parseMovementRules(reworded)).toThrowError(/does not know: fifteen/);
    expect(() => parseMovementRules(reworded)).toThrowError(/extend NUMBER_WORDS/);
  });
});

describe("parseFoodMaintenance", () => {
  it("reads the food maintenance value and the foods it applies to", () => {
    expect(parseFoodMaintenance(RULES_HTML)).toEqual({
      value: 50,
      foods: ["grain", "livestock", "fish", "meals"]
    });
    expect(parseFoodMaintenance(ARCANUM_RULES_HTML)).toEqual({
      value: 30,
      foods: ["grain", "livestock", "fish", "meals"]
    });
    expect(parseFoodMaintenance(TRIDENT_RULES_HTML)).toEqual({
      value: 30,
      foods: ["grain", "livestock", "fish", "meals"]
    });
  });

  it("refuses a rules page that never prices food", () => {
    expect(() =>
      parseFoodMaintenance("<html><body>a page about something else</body></html>")
    ).toThrowError(RulesetScrapeError);
    expect(() =>
      parseFoodMaintenance("<html><body>a page about something else</body></html>")
    ).toThrowError(/foodMaintenance/);
  });
});

describe("parseWeatherGap", () => {
  it("reads New Origins' implied winter rule as an open gap", () => {
    const gap = parseWeatherGap(RULES_HTML);

    expect(gap.modelled).toBe(false);
    expect(gap.note).toMatch(/winter/i);
    expect(gap.consequence).toMatch(/under-cost/i);
    expect(gap.evidence).toContain("in winter");
  });

  it("reads New Age's statement that weather never changes movement", () => {
    for (const html of [ARCANUM_RULES_HTML, TRIDENT_RULES_HTML]) {
      const gap = parseWeatherGap(html);
      expect(gap.modelled).toBe(true);
      expect(gap.evidence).toContain("it is description only");
    }
  });

  it("refuses a rules page that says nothing about weather", () => {
    expect(() => parseWeatherGap("<html><body>no weather here</body></html>")).toThrowError(
      RulesetScrapeError
    );
    expect(() => parseWeatherGap("<html><body>no weather here</body></html>")).toThrowError(
      /weatherRule/
    );
  });
});

describe("parseRegionResources", () => {
  it("reads the region resources table", () => {
    const resources = parseRegionResources(RULES_HTML);

    expect(Object.keys(resources)).toEqual([
      "ocean",
      "plain",
      "forest",
      "mountain",
      "swamp",
      "jungle",
      "desert",
      "tundra",
      "volcano"
    ]);
    expect(resources.swamp).toEqual(["wood", "floater hide", "herb", "mushroom"]);
    expect(resources.mountain).toEqual(["iron", "stone", "mithril", "rootstone", "admantium"]);
  });

  it("refuses a resource cell it cannot read", () => {
    const broken = RULES_HTML.replace(
      "wood (100%), floater hide (40%), herb (100%), mushroom (30%).",
      "wood (100%), floater hide, herb (100%), mushroom (30%)."
    );

    expect(() => parseRegionResources(broken)).toThrowError(/swamp/);
  });
});
