/**
 * Assembles the one file the application reads: `config/public/ruleset.json`.
 *
 * The shell fetches this at startup and hands it to the Rust core, which is what keeps the core
 * free of file I/O and therefore still able to compile to wasm. Correcting a value means editing
 * the served file and reloading - no rebuild.
 */

import {
  parseBuildingReference,
  parseItemReference,
  parseSkillReference,
  type BuildingReference,
  type ItemReference,
  type SkillReference
} from "./data";
import { parseMovementRules, RulesetScrapeError, type MovementRules } from "./rules";

/**
 * How much stronger than us the opposition has to be before a hex is called dangerous.
 *
 * These are the only numbers in the file the game did not tell us, which is why they carry
 * `scraped: false`. Tune them freely; nothing about them claims to mirror the server.
 */
export type RiskThresholds = {
  scraped: false;
  note: string;
  mediumRatio: number;
  highRatio: number;
};

/**
 * Something the game does that this ruleset cannot describe.
 *
 * Recorded rather than omitted, so the file never implies it covers more than it does. A consumer
 * can read `modelled: false` and say so in the interface instead of presenting a number as fact.
 */
export type Gap = {
  modelled: false;
  /** What the rule is, as far as the page reveals it. */
  note: string;
  /** What goes wrong while it is unmodelled, in the direction it goes wrong. */
  consequence: string;
  /** The page's own words, so the claim can be checked rather than taken on trust. */
  evidence: string;
};

export type Ruleset = {
  source: {
    rulesUrl: string;
    dataUrl: string;
    fetchedAt: string;
    note: string;
  };
  movement: MovementRules;
  risk: RiskThresholds;
  gaps: { weather: Gap };
  items: ItemReference;
  skills: SkillReference;
  buildings: BuildingReference;
};

export type BuildInput = {
  rulesHtml: string;
  dataHtml: string;
  rulesUrl: string;
  dataUrl: string;
  fetchedAt: string;
};

const DEFAULT_RISK: RiskThresholds = {
  scraped: false,
  note:
    "Chosen by Atlantis HUD, not scraped from the game. A hex is medium risk once hostile " +
    "strength reaches mediumRatio times our own, and high risk at highRatio.",
  mediumRatio: 1,
  highRatio: 3
};

/**
 * The rules page never states a weather rule, but it proves one exists.
 *
 * A walker has two movement points and a mountain costs two, so two is exactly enough - yet the
 * page says a walker cannot enter a mountain in winter in one turn. Winter therefore costs at
 * least three, and the page gives no multiplier, no affected-terrain list, and no way to tell
 * which months are winter. Turn reports carry no weather line either, so there is nothing to
 * scrape and nothing to infer.
 */
const WEATHER_GAP: Gap = {
  modelled: false,
  note:
    "The rules page states no weather rule, but implies one: winter raises the cost of at least " +
    "mountain terrain above a walker's two movement points, by an amount the page never gives.",
  consequence:
    "A route crossing a winter month is under-cost, so a journey can look achievable when it is " +
    "not. Present such a route as a lower bound rather than as fact.",
  evidence:
    "a unit on foot trying to move into a mountain region in winter would not have enough " +
    "movement points to enter in one turn"
};

export function buildRuleset(input: BuildInput): Ruleset {
  // Movement first: it is the part that stops the run, and there is no point reading a catalogue
  // for a ruleset we are going to refuse anyway.
  const movement = parseMovementRules(input.rulesHtml);
  const items = parseItemReference(input.dataHtml);
  // Buildings come from the data page too - the game's own object list, not the rules page's
  // generic table - so this reads after the items and before the race check below, which is the
  // more fundamental refusal and must come first. An empty map is a valid answer: it is what
  // `Ruleset::knows_buildings()` reads as "this ruleset cannot tell you", so there is no floor
  // check here.
  const buildings = parseBuildingReference(input.dataHtml);

  // The item parser is tolerant and objects only when it finds nothing at all, so a reshaped page
  // that left a handful of entries readable would sail through. This floor is tied to what the
  // catalogue is for - separating men from equipment - rather than to a count someone picked.
  if (!Object.values(items).some((entry) => entry.kind === "man")) {
    throw new RulesetScrapeError(
      `read ${Object.keys(items).length} items from the data page but not one race among them. ` +
        "A ruleset that names no races cannot tell men from equipment; the page has probably " +
        "changed shape."
    );
  }

  // After the race check, so a page that is unreadable in both ways is refused for the more
  // fundamental reason first.
  const skills = parseSkillReference(input.dataHtml);

  // The skill parser objects only when it finds nothing at all, and a catalogue where nothing
  // carries a price is the same thing as no catalogue for the one consumer it has - order
  // validation, which prices a STUDY order from it.
  if (!Object.values(skills).some((entry) => entry.cost !== null)) {
    throw new RulesetScrapeError(
      `read ${Object.keys(skills).length} skills from the data page and a study cost for none ` +
        "of them. Expected `This skill costs 10 silver per month of study`; the page has " +
        "probably changed shape."
    );
  }

  return {
    source: {
      rulesUrl: input.rulesUrl,
      dataUrl: input.dataUrl,
      fetchedAt: input.fetchedAt,
      note:
        "Generated by `pnpm --filter @atlantis/ruleset scrape`. The movement, items and skills " +
        "blocks are scraped from the URLs above; each movement value records the sentence it " +
        "came from. Re-run the fetch rather than hand-editing, unless you are deliberately " +
        "overriding a value."
    },
    movement,
    risk: DEFAULT_RISK,
    gaps: { weather: WEATHER_GAP },
    items,
    skills,
    buildings
  };
}
