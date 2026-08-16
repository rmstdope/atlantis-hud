/**
 * Reads the item catalogue out of a game's own data page.
 *
 * This is the item reference the report parser has always lacked: without it a unit line like
 * `50 leaders [LEAD], 30 swords [SWOR]` cannot be split into men and equipment, because nothing in
 * the report marks which tags are people.
 *
 * Unlike the movement rules, this parser is tolerant in the same way the report parser is. A
 * movement number that cannot be read makes every route wrong, so it stops the run; one exotic
 * monster phrasing its attacks unusually should not cost us the other four hundred entries.
 */

import { preformattedText } from "./html";
import { RulesetScrapeError } from "./rules";

export type ItemKind = "man" | "mount" | "monster" | "ship" | "equipment";

export type ItemCapacity = {
  walk: number;
  ride: number;
  fly: number;
  swim: number;
};

export type MonsterCombat = {
  skill: number;
  attacksPerRound: number;
  hitsToKill: number;
  damagePerAttack: number;
};

/** Which modes an item can move itself in, whether or not it has spare capacity to carry anything. */
export type SelfMobility = {
  walk: boolean;
  ride: boolean;
  fly: boolean;
  swim: boolean;
};

export type ItemEntry = {
  tag: string;
  name: string;
  kind: ItemKind;
  weight: number;
  capacity: ItemCapacity;
  /**
   * Capability, kept separate from capacity because the page states them separately.
   *
   * Most entries give a number (`walking capacity 20`), but thirteen state the bare capability
   * instead (`livestock [LIVE], weight 50, can walk`). Recording only the number left those
   * looking like items that cannot move at all.
   */
  selfMobile: SelfMobility;
  /** Hexes per month this item can carry itself, when the page says. */
  moves: number;
  /** Present only for monsters, and only when the page stated all four numbers. */
  combat?: MonsterCombat;
  /**
   * Cargo a ship carries, which is a different thing from an item carrying itself about.
   *
   * Ships state no weight of their own, so `weight` is 0 for all of them - not stated rather than
   * measured. Fleet movement is out of scope for the planner; this is recorded so it is not lost.
   */
  cargoCapacity?: number;
  /**
   * The qualifier attached to a capacity, when the page attaches one.
   *
   * A wagon reads "walking capacity 200 when hitched to a horse", and the rules page adds that
   * "the excess wagons count as weight, not capacity". Storing 200 with the condition thrown away
   * would be exactly the sort of plausible-but-wrong number this package exists to avoid.
   */
  capacityCondition?: string;
  /**
   * Levels of sailing skill a ship's crew must hold between them to sail it, as the page states:
   * "This ship requires a total of 4 levels of sailing skill to sail." Present only for ships.
   *
   * Not to be confused with Summon Wind or the windchime, which each add movement points "to ships
   * requiring up to N sailing skill points" - close wording, but neither states a ship's own
   * requirement, and the ship-only guard below keeps them from being mistaken for one.
   */
  sailingSkill?: number;
};

export type ItemReference = Record<string, ItemEntry>;

/**
 * A skill, and what a month of studying it costs.
 *
 * Kept apart from the item catalogue rather than merged into it: ten tags mean one thing as a
 * skill and another as an item - FISH is fishing and also fish, HERB is herb lore and also herbs -
 * so one map would have each pair overwrite the other.
 */
/** One thing a cast consumes: an item tag and how many, silver being `SILV`. */
export type CastInput = { tag: string; amount: number };

/**
 * What CASTing the skill consumes, as the data page states it: `costs`, each taken once per cast
 * (an input with no number is one), and for transmutation the output tag -> the source tag it is
 * made from. `null` when the page states no cost - most spells.
 */
export type CastCost = { costs: CastInput[]; transmute: Record<string, string> };

/** One thing a skill can make, and the level at which it can first be made. */
export type Production = { tag: string; level: number };

export type SkillEntry = {
  tag: string;
  name: string;
  /**
   * Silver per man per month, or null for a skill the page prices nowhere.
   *
   * Only annihilation, which "cannot be studied via normal means". A null is what lets a consumer
   * stay silent about it; a 0 would say studying it is free, and a 10 would invent a figure.
   */
  cost: number | null;
  /** The highest level the page gives the skill an entry for. */
  maxLevel: number;
  /** What CASTing this skill consumes, or null for the (large majority) that state no cost. */
  cast: CastCost | null;
  /**
   * What a unit with this skill may PRODUCE, in the order the page lists it, each with the level
   * at which it becomes available. Empty for the great majority of skills, which make nothing.
   */
  produces: Production[];
};

export type SkillReference = Record<string, SkillEntry>;

export { RulesetScrapeError };

/**
 * One entry, as the page lays it out: an opening line naming the item and its tag, then prose.
 *
 * Entries are separated by blank lines and continued by indentation, so the text is rejoined into
 * a single line before anything is read out of it.
 */
function entryParagraphs(html: string): string[] {
  const pre = preformattedText(html);
  return pre
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

function readNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? null : value;
}

/**
 * Classifies an entry from the sentence the page uses to introduce it.
 *
 * Order matters: a mount is also described with capacities, and a monster entry can mention a
 * race, so the most specific marker is tested first.
 */
function classify(text: string): ItemKind {
  if (/\bThis is a monster\b/i.test(text)) {
    return "monster";
  }

  // A race marker beats a mount marker, because a centaur carries both:
  //
  //   "centaur [CTAU] ... This race may study ... to level 2. This is a mount."
  //
  // Calling it a mount would keep it out of every headcount, which defeats the one thing this
  // catalogue exists to make possible - telling men from equipment.
  if (/\bThis race may study\b/i.test(text)) {
    return "man";
  }
  if (/\bThis is a mount\b/i.test(text)) {
    return "mount";
  }

  // Flying ships describe themselves as `a flying 'ship'`, quotes and all, so the literal phrase
  // "This is a ship" misses Balloon, Airship and Cloudship.
  if (/\bThis is an? (?:flying )?'?ship'?\b/i.test(text)) {
    return "ship";
  }
  return "equipment";
}

function readCombat(text: string): MonsterCombat | undefined {
  // Combat skill goes negative: the illusory monsters are all `combat skill of -5`, and a pattern
  // demanding digits alone silently dropped every one of them.
  const skill = readNumber(text, /monster attacks with a combat skill of (-?\d+)/i);
  const attacks = readNumber(text, /monster has (-?\d+) melee attacks? per round/i);
  const hits = readNumber(text, /takes (-?\d+) hits? to kill/i);

  // Damage is anchored to the melee clause rather than read loose. A dozen monsters state damage
  // twice - a spell's first, then melee - so an unanchored pattern reads the spell's number. Every
  // figure in the committed fixture is 1, which is precisely why that would have gone unnoticed.
  const damage = readNumber(
    text,
    /melee attacks? per round and takes -?\d+ hits? to kill and each attack deals (-?\d+) damage/i
  );

  if (skill === null || attacks === null || hits === null || damage === null) {
    return undefined;
  }
  return { skill, attacksPerRound: attacks, hitsToKill: hits, damagePerAttack: damage };
}

/** Picks up a qualifier such as `walking capacity 200 when hitched to a horse`. */
function conditionOf(text: string): { capacityCondition?: string } {
  const match = text.match(/\b(?:walking|riding|flying|swimming) capacity \d+ (when [^,.]+)/i);
  return match ? { capacityCondition: match[1].trim() } : {};
}

/** A ship's cargo hold, which the page states as `with a capacity of 150`. */
function cargoOf(kind: ItemKind, text: string): { cargoCapacity?: number } {
  if (kind !== "ship") {
    return {};
  }
  const capacity = readNumber(text, /with a capacity of (\d+)/i);
  return capacity === null ? {} : { cargoCapacity: capacity };
}

/**
 * The sailing skill a ship's crew needs between them, which the page states as `requires a total
 * of 4 levels of sailing skill to sail`.
 *
 * Ship-only, like `cargoOf`: Summon Wind and the windchime use close wording - "ships requiring up
 * to N sailing skill points" - for a bonus they grant, not a requirement of their own, and neither
 * is a ship to begin with.
 */
function sailingOf(kind: ItemKind, text: string): { sailingSkill?: number } {
  if (kind !== "ship") {
    return {};
  }
  const skill = readNumber(text, /requires a total of (\d+) levels? of sailing skill/i);
  return skill === null ? {} : { sailingSkill: skill };
}

export function parseItemReference(html: string): ItemReference {
  const items: ItemReference = {};

  for (const paragraph of entryParagraphs(html)) {
    // `leader [LEAD], weight 10, ...` or `Longship [LONG]. This is a ship ...`. A skill entry reads
    // `mining [MINI] 1: ...`, which this deliberately does not match.
    //
    // The name may not contain sentence punctuation, which is what keeps the tag bound to the
    // entry that opens the paragraph. Allowing it to wander produced a real bug: the structure
    // entry `Dormant Monolith: This is a building. This structure requires a sacrifice of 50
    // leaders [LEAD].` matched as though it were the definition of LEAD, and overwrote it.
    const opening = paragraph.match(/^([^.:[\]]{1,40}) \[([A-Z0-9]{2,6})\][,.]/);
    if (!opening) {
      continue;
    }

    const [, name, tag] = opening;
    const kind = classify(paragraph);

    // A ship states its capacity as cargo, not as a way of carrying itself about, so it is not
    // read into the movement capacities.
    const capacity: ItemCapacity = {
      walk: readNumber(paragraph, /walking capacity (\d+)/i) ?? 0,
      ride: readNumber(paragraph, /riding capacity (\d+)/i) ?? 0,
      fly: readNumber(paragraph, /flying capacity (\d+)/i) ?? 0,
      swim: readNumber(paragraph, /swimming capacity (\d+)/i) ?? 0
    };

    // A stated number implies the capability; the bare `can walk` form states it on its own.
    const selfMobile: SelfMobility = {
      walk: capacity.walk > 0 || /\bcan walk\b/i.test(paragraph),
      ride: capacity.ride > 0 || /\bcan ride\b/i.test(paragraph),
      fly: capacity.fly > 0 || /\bcan fly\b/i.test(paragraph),
      swim: capacity.swim > 0 || /\bcan swim\b/i.test(paragraph)
    };

    const entry: ItemEntry = {
      tag,
      name: name.trim(),
      kind,
      weight: readNumber(paragraph, /\bweight (\d+)/i) ?? 0,
      capacity,
      selfMobile,
      ...conditionOf(paragraph),
      ...cargoOf(kind, paragraph),
      ...sailingOf(kind, paragraph),
      moves:
        readNumber(paragraph, /moves (\d+) hexes? per month/i) ??
        readNumber(paragraph, /speed of (\d+) hexes? per month/i) ??
        0
    };

    const combat = kind === "monster" ? readCombat(paragraph) : undefined;
    if (combat) {
      entry.combat = combat;
    }

    items[tag] = entry;
  }

  if (Object.keys(items).length === 0) {
    throw new RulesetScrapeError(
      "could not read any item entries from the data page. Expected a <pre> block of entries " +
        "shaped like `horse [HORS], weight 50, ...`; the page has probably changed shape."
    );
  }

  return items;
}

/**
 * A skill entry's opening: `mining [MINI] 1: This skill deals with ...`.
 *
 * The level and the colon are what separate this from an item, which opens `horse [HORS], weight`.
 * Both live in the same `<pre>` block, and `parseItemReference` skips these paragraphs for exactly
 * the same reason this one skips its own.
 */
const SKILL_OPENING = /^([^.:[\]]{1,40}) \[([A-Z0-9]{2,6})\] (\d+): /;

/** "This skill costs 10 silver per month of study." Stated once per skill, on its level 1 entry. */
const STUDY_COST = /This skill costs (\d+) silver per month of study/i;

/**
 * "via magic at a cost of 600 silver [SILV]." / "... of sword [SWOR]." / "... of 75 floater
 * hides [FLOA] and 75 ironwood [IRWD]." Stops at the first period: the sentence continues "To use
 * this spell ...", and no input name in the fixture carries a dot of its own.
 */
const CAST_COST = /via magic at a cost of ([^.]+)\./i;
/** One input inside the list `CAST_COST` captures: an optional number, a name, the tag. */
const CAST_INPUT = /^(?:(\d+) )?[a-z][a-z ]* \[([A-Z0-9]{2,6})\]$/i;
/** "the attempt costs 1000 silver." (Construct Gate) */
const ATTEMPT_COST = /the attempt costs (\d+) silver/i;
/** "2 stone [STON] times the skill level into rootstone [ROOT]" - the source and what it becomes. */
const TRANSMUTE = /\d+ [a-z ]+ \[([A-Z0-9]{2,6})\] times the skill level into [a-z ]+ \[([A-Z0-9]{2,6})\]/gi;

/**
 * Reads what a single level's paragraph says CASTing the skill consumes, or `null` when it says
 * nothing - true of most spells (summons, lores, combat effects state no cost at all).
 *
 * An input inside the `CAST_COST` list that does not match `CAST_INPUT` throws rather than being
 * silently dropped: the page has changed shape, and a cost quietly missing is exactly the failure
 * this catalogue exists to prevent - see `RulesetScrapeError`.
 */
function readCastCost(tag: string, paragraph: string): CastCost | null {
  const costs: CastInput[] = [];

  const costMatch = paragraph.match(CAST_COST);
  if (costMatch) {
    for (const part of costMatch[1].split(" and ")) {
      const inputMatch = part.trim().match(CAST_INPUT);
      if (!inputMatch) {
        throw new RulesetScrapeError(
          `could not read the casting cost of skill ${tag}: "${part.trim()}" in "${costMatch[0]}"`
        );
      }
      const [, amount, inputTag] = inputMatch;
      costs.push({ tag: inputTag, amount: amount === undefined ? 1 : Number.parseInt(amount, 10) });
    }
  }

  const attemptCost = readNumber(paragraph, ATTEMPT_COST);
  if (attemptCost !== null) {
    costs.push({ tag: "SILV", amount: attemptCost });
  }

  const transmute: Record<string, string> = {};
  for (const match of paragraph.matchAll(TRANSMUTE)) {
    const [, source, output] = match;
    transmute[output] = source;
  }

  if (costs.length === 0 && Object.keys(transmute).length === 0) {
    return null;
  }
  return { costs, transmute };
}

/** The clause a production sentence opens with. Every PRODUCE on the page today is a `may PRODUCE`. */
const PRODUCTION = /may PRODUCE ([^.]*)\./i;
/** What separates one production from the next: `at a rate of 1 per man-month`, `... per 3 man-months`. */
const PRODUCTION_RATE = /at a rate of [^.]*?man-months?/i;
/** The tag in `swords [SWOR]`, `a number of meals [MEAL]`. */
const PRODUCED_TAG = /\[([A-Z0-9]{2,6})\]/;

/**
 * What one level's paragraph says the skill may produce, or `[]` when it says nothing - true of
 * most skills.
 *
 * The whole difficulty is telling a product from its materials: `swords [SWOR] from iron [IRON]`
 * names two items and the skill makes only the first. So the clause is cut into one segment per
 * production - the rate phrase is what ends each - and within a segment everything from the first
 * ` from ` is dropped before the tag is read. A trailing empty segment carries no tag and is
 * skipped; a clause that yields no tag at all is the page having changed shape, and throws.
 */
function readProduction(tag: string, paragraph: string, level: number): Production[] {
  const clause = paragraph.match(PRODUCTION);
  if (!clause) {
    return [];
  }

  const made: Production[] = [];
  for (const segment of clause[1].split(PRODUCTION_RATE)) {
    const found = segment.split(" from ")[0].match(PRODUCED_TAG);
    if (found) {
      made.push({ tag: found[1], level });
    }
  }

  if (made.length === 0) {
    throw new RulesetScrapeError(`could not read what skill ${tag} produces from "${clause[0]}"`);
  }
  return made;
}

/** Unions production across levels: a tag keeps the lowest level that granted it. */
function mergeProduction(existing: Production[] | undefined, found: Production[]): Production[] {
  const merged = [...(existing ?? [])];
  for (const made of found) {
    if (!merged.some((seen) => seen.tag === made.tag)) {
      merged.push(made);
    }
  }
  return merged;
}

/** Unions two `CastCost`s across levels: `costs` from whichever level states them, `transmute` merged. */
function mergeCast(existing: CastCost | null | undefined, found: CastCost | null): CastCost | null {
  if (!existing) {
    return found;
  }
  if (!found) {
    return existing;
  }
  return {
    costs: existing.costs.length > 0 ? existing.costs : found.costs,
    transmute: { ...existing.transmute, ...found.transmute }
  };
}

/**
 * Reads the skill catalogue out of the same data page the items come from.
 *
 * A skill has five entries, one per level, and only the first states the study cost - so the
 * entries are folded together by tag: the cost from whichever level states it, the name from the
 * lowest, the level from the highest, and the casting cost unioned across every level that states
 * one (Summon Wind's is on level 3, Transmutation adds outputs on levels 2 and 3).
 */
export function parseSkillReference(html: string): SkillReference {
  const skills: SkillReference = {};

  for (const paragraph of entryParagraphs(html)) {
    const opening = paragraph.match(SKILL_OPENING);
    if (!opening) {
      continue;
    }

    const [, name, tag, level] = opening;
    const stated = readNumber(paragraph, STUDY_COST);
    const existing = skills[tag];

    skills[tag] = {
      tag,
      name: existing?.name ?? name.trim(),
      // Kept once found. Levels above the first say nothing about cost, and letting a later entry
      // write null over a figure the page did give would lose every cost in the catalogue.
      cost: existing?.cost ?? stated,
      maxLevel: Math.max(existing?.maxLevel ?? 0, Number.parseInt(level, 10)),
      cast: mergeCast(existing?.cast, readCastCost(tag, paragraph)),
      produces: mergeProduction(
        existing?.produces,
        readProduction(tag, paragraph, Number.parseInt(level, 10))
      )
    };
  }

  if (Object.keys(skills).length === 0) {
    throw new RulesetScrapeError(
      "could not read any skill entries from the data page. Expected a <pre> block of entries " +
        "shaped like `mining [MINI] 1: ...`; the page has probably changed shape."
    );
  }

  return skills;
}
