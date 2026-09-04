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

/** One tier of the terrain premium: what it costs, and the sentence's own list of terrain. */
type TerrainTier = { cost: number; list: string };

const TERRAIN_INTRO = `Moving from one region to another normally takes ${NUMBER_PATTERN} movement point`;

/** New Origins: one premium, its number spelled as a word. */
const SINGLE_PREMIUM = new RegExp(
  `${TERRAIN_INTRO}[^.]*?terrain types take ${NUMBER_PATTERN} movement points for ([a-z ]+?) ` +
    `units to enter: ([^.]+)\\.`,
  "i"
);

/** New Age: one clause per tier, the clauses separated by semicolons. */
const TIERED_PREMIUMS = new RegExp(
  `${TERRAIN_INTRO}, except for the following terrain types, which cost a ([a-z ]+?) unit more ` +
    `to enter: ([^.]+)\\.`,
  "i"
);

/**
 * `2 movement points for forest, mountain` - one clause of the tiered wording.
 *
 * The cost is captured as a bare token rather than as `NUMBER_PATTERN`, so a clause whose number
 * is a word the scraper has not been taught fails with the message that names the fix
 * (`extend NUMBER_WORDS`) rather than with one about the sentence's grammar.
 */
const TIER_CLAUSE = /^\s*(\S+) movement points? for (.+)$/i;

/**
 * Reads whichever terrain sentence the page states, or stops the run naming the value.
 *
 * The tiered wording is tried first and the single one is the fallback, so a page matching neither
 * fails on the wording this repository has always understood, with the message it has always given.
 */
function readTerrainSentence(text: string): {
  match: RegExpMatchArray;
  modes: string;
  normal: number | null;
  tiers: TerrainTier[];
} {
  const tiered = text.match(TIERED_PREMIUMS);
  if (tiered) {
    const tiers = tiered[3].split(";").map((clause) => {
      const parsed = clause.match(TIER_CLAUSE);
      if (!parsed) {
        throw new RulesetScrapeError(
          `could not read terrainCosts: ${clause.trim()} is not a cost and a list of terrain`
        );
      }
      const cost = toNumber(parsed[1]);
      if (cost === null) {
        throw new RulesetScrapeError(
          "the rules page used a number word the scraper does not know; extend NUMBER_WORDS"
        );
      }
      return { cost, list: parsed[2] };
    });
    return { match: tiered, modes: tiered[2], normal: toNumber(tiered[1]), tiers };
  }

  const single = requireMatch(text, "terrainCosts", SINGLE_PREMIUM);
  return {
    match: single,
    modes: single[3],
    normal: toNumber(single[1]),
    tiers: [{ cost: toNumber(single[2]) ?? Number.NaN, list: single[4] }]
  };
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
  //  enter: Forest, Mountain, Swamp, Jungle, and Tundra." - or New Age's tiered wording, which
  //  prices a volcano above a forest in the same sentence.
  const terrain = readTerrainSentence(text);

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
  const normal = terrain.normal;
  const minimumCost = toNumber(road[2]);
  const flatCost = toNumber(sailingCost[1]);

  if (
    walk === null ||
    ride === null ||
    fly === null ||
    normal === null ||
    terrain.tiers.some((tier) => !Number.isInteger(tier.cost)) ||
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
  const premiumFor = terrain.modes
    .split(/,| and | or /i)
    .map((mode) => MODE_NAMES[mode.trim().toLowerCase()])
    .filter((mode): mode is MovementMode => mode !== undefined);

  if (premiumFor.length === 0) {
    throw new RulesetScrapeError(
      "could not read terrainCosts: the page named no modes of travel the premium applies to"
    );
  }

  // A null prototype, not `{}`: a terrain named `__proto__` on a plain object would set the
  // prototype rather than an own property and vanish from `Object.keys`, which is exactly the
  // silent under-costing this shape exists to prevent. `constructor` and friends would likewise
  // read back as inherited functions in the duplicate-price check below.
  const premiums: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const tier of terrain.tiers) {
    for (const name of tier.list
      .split(/,| and /i)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)) {
      const already = premiums[name];
      if (already !== undefined && already !== tier.cost) {
        throw new RulesetScrapeError(
          `could not read terrainCosts: ${name} is priced at both ${already} and ${tier.cost}`
        );
      }
      premiums[name] = tier.cost;
    }
  }

  if (Object.keys(premiums).length === 0) {
    throw new RulesetScrapeError("could not read terrainCosts: the page listed no terrain names");
  }

  return {
    movementPoints: { walk, ride, fly },
    terrainCosts: { normal, premiums, premiumFor },
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
      terrainCosts: sentence(terrain.match),
      road: sentence(road),
      ocean: sentence(ocean),
      sailing: `${sentence(sailingCost)}. ${sentence(coastal)}`
    }
  };
}

