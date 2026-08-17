/**
 * Reads the movement rules out of a game's own rules page.
 *
 * Atlantis servers generate this page per game, so the numbers differ between rulesets. Scraping
 * them beats hard-coding them: the alternative is a table that silently disagrees with the server.
 *
 * Every value is anchored to the page's own wording, and anything that does not match stops the
 * run. Falling back to a default here would be the one failure mode worth avoiding above all
 * others - a route costed against numbers this game does not use, presented as fact.
 */

import { htmlToText, tableHeader, tableRows } from "./html";

export type MovementPoints = {
  walk: number;
  ride: number;
  fly: number;
};

export type TerrainCosts = {
  /** What entering a region costs when nothing makes it harder. */
  normal: number;
  /** What the terrains listed below cost instead. */
  doubledCost: number;
  /** Lower-cased terrain names, in the order the page lists them. */
  doubled: string[];
  /**
   * The modes of travel the premium applies to, lower-cased.
   *
   * The sentence names them - "take two movement points for riding or walking units to enter" -
   * and flight is deliberately absent, so a flier pays the ordinary cost everywhere. Reading this
   * rather than assuming it keeps the exception where the game put it.
   */
  doubledFor: string[];
};

export type RoadRule = {
  /** What a connected road divides the cost by. */
  divisor: number;
  /** The floor that division may not go below. */
  minimumCost: number;
};

export type OceanRule = {
  requiresShipUnlessFlying: boolean;
  flyingMustEndOnLand: boolean;
  /**
   * The terrain the rule is about, lower-cased.
   *
   * Taken from the rule's own sentence rather than assumed to be "ocean", so the planner can
   * recognise a water hex from the terrain string a report prints without the core hardcoding a
   * name that belongs to the game.
   */
  terrain: string;
};

export type SailingRule = {
  /**
   * Movement points a fleet spends entering any region, whatever the terrain.
   *
   * "For a fleet to enter any region only costs one movement point; the cost of two movement
   * points for entering, say, a forest coastal region, does not apply." A fleet's own rule, not
   * another entry on the terrain premium.
   */
  flatCost: number;
  /**
   * Whether a fleet may only enter a land region through a coastal one.
   *
   * "A coastal region is defined as a non-ocean region with at least one adjacent ocean region."
   */
  landNeedsCoast: boolean;
  /** The terrain a fleet sails freely across, lower-cased. Mirrors {@link OceanRule.terrain}. */
  terrain: string;
};

export type MovementRules = {
  movementPoints: MovementPoints;
  terrainCosts: TerrainCosts;
  road: RoadRule;
  ocean: OceanRule;
  sailing: SailingRule;
  /** The sentence each value was read from, so a reader can check our work against the page. */
  provenance: {
    movementPoints: string;
    terrainCosts: string;
    road: string;
    ocean: string;
    sailing: string;
  };
};

/** Raised when the page does not say what the scraper needs, naming the value that is missing. */
export class RulesetScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesetScrapeError";
  }
}

/**
 * The page spells small numbers out, so digits alone would miss every one of them.
 *
 * Only the range a movement allowance plausibly falls in is covered; anything larger would be a
 * change worth failing on rather than guessing at.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};

const NUMBER_PATTERN = `(\\d+|${Object.keys(NUMBER_WORDS).join("|")})`;

function toNumber(token: string): number | null {
  const word = NUMBER_WORDS[token.toLowerCase()];
  if (word !== undefined) {
    return word;
  }
  const digits = Number.parseInt(token, 10);
  return Number.isNaN(digits) ? null : digits;
}

/**
 * Matches one anchored pattern, or stops the run naming the value that could not be read.
 *
 * `value` names the field in the output, so the message points at what to fix rather than at a
 * regex.
 */
function requireMatch(text: string, value: string, pattern: RegExp): RegExpMatchArray {
  const match = text.match(pattern);
  if (!match) {
    throw new RulesetScrapeError(
      `could not read ${value} from the rules page: no text matched ${pattern}. ` +
        `The page has probably been reworded; update the pattern rather than guessing a value.`
    );
  }
  return match;
}

/** Trims a matched sentence down to something readable in the committed JSON. */
function sentence(match: RegExpMatchArray): string {
  return match[0].trim().replace(/\s+/g, " ");
}

export function parseMovementRules(html: string): MovementRules {
  const text = htmlToText(html);

  // "Walking units have two movement points, riding units have four, and flying units have four."
  const points = requireMatch(
    text,
    "movementPoints",
    new RegExp(
      `Walking units have ${NUMBER_PATTERN} movement points?, ` +
        `riding units have ${NUMBER_PATTERN}, and flying units have ${NUMBER_PATTERN}`,
      "i"
    )
  );

  // "...the following terrain types take two movement points for riding or walking units to
  //  enter: Forest, Mountain, Swamp, Jungle, and Tundra."
  const terrain = requireMatch(
    text,
    "terrainCosts",
    new RegExp(
      `Moving from one region to another normally takes ${NUMBER_PATTERN} movement point[^.]*?` +
        `terrain types take ${NUMBER_PATTERN} movement points for ([a-z ]+?) units to ` +
        `enter: ([^.]+)\\.`,
      "i"
    )
  );

  // "If a road in the given direction is connected, units move along that road at half cost to a
  //  minimum of 1 movement point."
  const road = requireMatch(
    text,
    "road",
    new RegExp(
      `If a road in the given direction is connected, units move along that road at ` +
        `(half|a third of|a quarter of) cost to a minimum of ${NUMBER_PATTERN} movement point`,
      "i"
    )
  );

  // "Units may not move through ocean regions without using the SAIL order unless they are capable
  //  of flight, and even then, flying units must end their movement on land or else drown."
  const ocean = requireMatch(
    text,
    "ocean",
    /Units may not move through (\w+) regions without using the\s*SAIL\s*order unless they are capable of flight, and even then, flying units must end their movement on land or else drown/i
  );

  // "For a fleet to enter any region only costs one movement point; the cost of two movement
  //  points for entering, say, a forest coastal region, does not apply."
  const sailingCost = requireMatch(
    text,
    "sailing",
    new RegExp(
      `For a fleet to enter any region only costs ${NUMBER_PATTERN} movement points?`,
      "i"
    )
  );

  // "A coastal region is defined as a non-ocean region with at least one adjacent ocean region."
  const coastal = requireMatch(
    text,
    "sailing",
    /A coastal region is defined as a non-ocean region with at least one adjacent ocean region/i
  );

  const walk = toNumber(points[1]);
  const ride = toNumber(points[2]);
  const fly = toNumber(points[3]);
  const normal = toNumber(terrain[1]);
  const doubledCost = toNumber(terrain[2]);
  const minimumCost = toNumber(road[2]);
  const flatCost = toNumber(sailingCost[1]);

  if (
    walk === null ||
    ride === null ||
    fly === null ||
    normal === null ||
    doubledCost === null ||
    minimumCost === null ||
    flatCost === null
  ) {
    throw new RulesetScrapeError(
      "the rules page used a number word the scraper does not know; extend NUMBER_WORDS"
    );
  }

  const divisor = { half: 2, "a third of": 3, "a quarter of": 4 }[road[1].toLowerCase()];
  if (divisor === undefined) {
    throw new RulesetScrapeError(`could not read road: unknown fraction ${road[1]}`);
  }

  // "riding or walking" names the modes as the page conjugates them; the ruleset speaks of ride,
  // walk and fly, so they are normalised to that vocabulary.
  const doubledFor = terrain[3]
    .split(/,| and | or /i)
    .map((mode) => mode.trim().toLowerCase())
    .map((mode) => ({ riding: "ride", walking: "walk", flying: "fly", swimming: "swim" })[mode])
    .filter((mode): mode is string => mode !== undefined);

  if (doubledFor.length === 0) {
    throw new RulesetScrapeError(
      "could not read terrainCosts: the page named no modes of travel the premium applies to"
    );
  }

  const doubled = terrain[4]
    .split(/,| and /i)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (doubled.length === 0) {
    throw new RulesetScrapeError("could not read terrainCosts: the page listed no terrain names");
  }

  return {
    movementPoints: { walk, ride, fly },
    terrainCosts: { normal, doubledCost, doubled, doubledFor },
    road: { divisor, minimumCost },
    ocean: {
      requiresShipUnlessFlying: true,
      flyingMustEndOnLand: true,
      terrain: ocean[1].toLowerCase()
    },
    sailing: {
      flatCost,
      landNeedsCoast: true,
      terrain: ocean[1].toLowerCase()
    },
    provenance: {
      movementPoints: sentence(points),
      terrainCosts: sentence(terrain),
      road: sentence(road),
      ocean: sentence(ocean),
      sailing: `${sentence(sailingCost)}. ${sentence(coastal)}`
    }
  };
}

/** A building the rules table describes, and how many mages may study in it. */
export type BuildingEntry = {
  name: string;
  /** People it shelters. */
  size: number;
  /** Man-months of labour, and units of material, to finish it. */
  cost: number;
  /** What it is built from, as the table words it: `stone`, `wood`. */
  material: string;
  /**
   * How many mages the building provides study facilities for, "to enable unhindered study above
   * level 2 in magical skills". **Zero for a Tower** - the obvious guess is wrong in this ruleset,
   * and a mage studying in one loses half the month.
   */
  mages: number;
};

export type BuildingReference = Record<string, BuildingEntry>;

const BUILDING_HEADINGS = ["Size", "Cost", "Material", "Mages"];

/**
 * Reads the rules page's buildings table into a catalogue keyed by the building's name,
 * uppercased - the same convention `items` and `skills` use, so a report's printed kind can be
 * matched without caring about case.
 *
 * Columns are found by their heading rather than by a fixed position, because the header's first
 * cell is blank (the name column carries no heading of its own) and a naive zero-based read would
 * already be off by one.
 */
export function parseBuildings(html: string): BuildingReference {
  const rows = tableRows(html, BUILDING_HEADINGS);
  const header = tableHeader(html, BUILDING_HEADINGS);
  if (rows.length === 0 || !header) {
    throw new RulesetScrapeError(
      "could not read buildings: no table on the rules page has a header naming " +
        `${BUILDING_HEADINGS.join(", ")}. The page has probably been reworded; update the ` +
        "heading list rather than guessing a value."
    );
  }

  const columnOf = (heading: string): number => header.indexOf(heading.toLowerCase());
  const sizeCol = columnOf("Size");
  const costCol = columnOf("Cost");
  const materialCol = columnOf("Material");
  const magesCol = columnOf("Mages");

  const buildings: BuildingReference = {};
  for (const row of rows) {
    const name = row[0]?.trim();
    if (!name) {
      continue;
    }
    const size = toNumber(row[sizeCol] ?? "");
    const cost = toNumber(row[costCol] ?? "");
    const material = row[materialCol]?.trim();
    const mages = toNumber(row[magesCol] ?? "");
    if (size === null || cost === null || !material || mages === null) {
      throw new RulesetScrapeError(
        `could not read building "${name}": expected numeric Size, Cost and Mages and a ` +
          "Material name; the page has probably been reworded."
      );
    }
    buildings[name.toUpperCase()] = { name, size, cost, material, mages };
  }

  return buildings;
}
