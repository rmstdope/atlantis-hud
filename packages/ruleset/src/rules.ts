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

export type { MovementMode } from "./generated/MovementMode";
export type { MovementPoints } from "./generated/MovementPoints";
export type { MovementRules } from "./generated/MovementRules";
export type { OceanRule } from "./generated/OceanRule";
export type { RoadRule } from "./generated/RoadRule";
export type { SailingRule } from "./generated/SailingRule";
export type { TerrainCosts } from "./generated/TerrainCosts";

import type { MovementMode } from "./generated/MovementMode";
import type { MovementRules } from "./generated/MovementRules";
import { htmlToText } from "./html";

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
  // `swimming` is deliberately absent: this ruleset gives swimming no allowance, so the core's
  // MovementMode has no such variant and a scraped "swim" would fail every ruleset load.
  const MODE_NAMES: Record<string, MovementMode | undefined> = {
    riding: "ride",
    walking: "walk",
    flying: "fly"
  };
  const doubledFor = terrain[3]
    .split(/,| and | or /i)
    .map((mode) => MODE_NAMES[mode.trim().toLowerCase()])
    .filter((mode): mode is MovementMode => mode !== undefined);

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

