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

export type { CastCost } from "./generated/CastCost";
export type { CastInput } from "./generated/CastInput";
export type { ItemCapacity } from "./generated/ItemCapacity";
export type { ItemEntry } from "./generated/ItemEntry";
export type { ItemKind } from "./generated/ItemKind";
export type { MonsterCombat } from "./generated/MonsterCombat";
export type { Production } from "./generated/Production";
export type { ProductionInput } from "./generated/ProductionInput";
export type { SelfMobility } from "./generated/SelfMobility";
export type { Weapon } from "./generated/Weapon";

import type { CastCost } from "./generated/CastCost";
import type { CastInput } from "./generated/CastInput";
import type { ItemCapacity } from "./generated/ItemCapacity";
import type { ItemEntry } from "./generated/ItemEntry";
import type { ItemKind } from "./generated/ItemKind";
import type { MonsterCombat } from "./generated/MonsterCombat";
import type { Production } from "./generated/Production";
import type { ProductionInput } from "./generated/ProductionInput";
import type { SelfMobility } from "./generated/SelfMobility";
import type { Weapon } from "./generated/Weapon";
import { preformattedText } from "./html";
import { RulesetScrapeError } from "./rules";

export type ItemReference = Record<string, ItemEntry>;

/** A skill a unit must already have, at a level, before it may begin to study another. */
export type SkillRequirement = { tag: string; level: number };

/** What a skill's page says at one level, once the placeholders are dropped. */
export type SkillLevel = { level: number; description: string };

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
  /**
   * What the page says at each level, in level order, with the levels that say nothing left out.
   *
   * A list rather than a string because the page writes a skill five times, once per level, and
   * the interesting part is usually not level 1: mining reaches mithril at 3 and admantium at 5,
   * which is exactly what a reader opens the entry to find out. Levels the page fills with
   * `No skill report.` carry no information and are dropped, so a skill that says something only
   * at 1 and 3 has two entries here and not five.
   *
   * Absent rather than `[]` when the skill says nothing anywhere - the rule ah-3cj4.1 set for a
   * building's `size` and `cost`, applied here so the file reads consistently.
   */
  levels?: SkillLevel[];
  /**
   * Whether this is one of the magic skills.
   *
   * The data page marks magic nowhere - no flag, no grouping, no "may only be studied by a mage"
   * phrase - so this is read from the skill's own level-1 description instead: a skill whose
   * opening paragraph speaks of mages, magic, spells, casting, summoning, enchanting or the
   * Foundations is magic. Measured over the committed fixture this separates the catalogue
   * exactly: seventy magic, twenty-six mundane, and the twenty-six are armorer, building,
   * carpenter, combat and their kind. See `committed.test.ts` for the pinned classification.
   */
  magic: boolean;
  /**
   * What a unit must already have before it may begin this skill, as the data page's own `This
   * skill requires force [FORC] 1 to begin to study.` sentence states it. Empty - never absent -
   * for the majority of the catalogue, which states none.
   */
  requires: SkillRequirement[];
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
 * An entry's prose: everything after the first full stop that follows its `[TAG]`.
 *
 * Not simply "after the first full stop" - the preamble carries none before the tag, and anchoring
 * on the tag is what makes this exact rather than nearly right. `. ` rather than `.` so a full
 * stop inside the preamble cannot split the entry in the wrong place.
 */
function prose(paragraph: string): string | undefined {
  const after = paragraph.slice(paragraph.indexOf("]") + 1);
  const stop = after.indexOf(". ");
  const text = (stop === -1 ? "" : after.slice(stop + 2)).trim();
  return text === "" ? undefined : text;
}

/** The page's placeholder for a level that grants nothing. Not a description. */
const NO_REPORT = /^No skill report\.?$/i;

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

/** The withdrawal price, as a spreadable field so an item with none carries no key. */
function withdrawOf(paragraph: string): { withdrawCost?: number } {
  const cost = readNumber(paragraph, /costs (\d+) silver to withdraw/i);
  return cost === null ? {} : { withdrawCost: cost };
}

/** `No skill is needed to wield this weapon.` */
const WIELD_NONE = /No skill is needed to wield this weapon\./i;
/** `Knowledge of crossbow [XBOW] is needed to wield this weapon.` */
const WIELD_SKILL = /Knowledge of [a-z ]+ \[([A-Z]{2,6})\] is needed to wield this weapon\./i;

/**
 * The wield clause, as a spreadable field so an item that is not a weapon carries no key.
 *
 * Matched on the wield sentence and never on the word "weapon", which also appears in armor
 * descriptions ("versus slashing attacks"), in race descriptions, and in the weaponsmith skill's
 * own text. Races are excluded on `kind` before any matching, because a race that may study
 * weaponsmith is not a weapon.
 *
 * The tag captured is a *skill* tag, to be looked up in `skills`. `XBOW` and `LBOW` are each both
 * an item tag and a skill tag, so the crossbow item needing the crossbow skill is a genuine
 * coincidence rather than a self-reference; `DBOW`, which needs `LBOW`, is the case that shows it.
 */
function weaponOf(kind: ItemKind, paragraph: string): { weapon?: Weapon } {
  if (kind === "man") {
    return {};
  }

  const none = WIELD_NONE.test(paragraph);
  const skill = paragraph.match(WIELD_SKILL);

  if (none && skill) {
    throw new RulesetScrapeError(
      "an item states both that no skill is needed to wield it and that a skill is: " +
        `${paragraph.slice(0, 70)}. The page has probably changed shape.`
    );
  }
  if (none) {
    return { weapon: { needs: null } };
  }
  if (skill) {
    return { weapon: { needs: skill[1] } };
  }
  return {};
}

/** The prose of an item entry, as a spreadable field so an entry with none carries no key. */
function descriptionOf(paragraph: string): { description?: string } {
  const text = prose(paragraph);
  return text === undefined ? {} : { description: text };
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
      ...withdrawOf(paragraph),
      ...cargoOf(kind, paragraph),
      ...sailingOf(kind, paragraph),
      ...weaponOf(kind, paragraph),
      ...descriptionOf(paragraph),
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
export const SKILL_OPENING = /^([^.:[\]]{1,40}) \[([A-Z0-9]{2,6})\] (\d+): /;

/** "This skill costs 10 silver per month of study." Stated once per skill, on its level 1 entry. */
const STUDY_COST = /This skill costs (\d+) silver per month of study/i;

/**
 * "This skill requires force [FORC] 1 to begin to study.", and for half of the sixty-six that state
 * one, "... force [FORC] 1 and pattern [PATT] 1 to begin to study."
 *
 * Three forms appear in the committed page - one requirement, two joined by ` and `, and (twice)
 * three joined by `, ` and a final ` and `. Rather than encode that punctuation, the tag/level
 * pairs are read straight out of the sentence, which is separator-free and survives a fourth form.
 */
const STUDY_REQUIREMENT = /This skill requires (.+?) to begin to study\./i;

/** The tag and level of one requirement: `force [FORC] 1`. */
const REQUIREMENT_CLAUSE = /\[([A-Z0-9]{2,6})\]\s+(\d+)/g;

/**
 * Reads the prerequisites out of a skill's own paragraph.
 *
 * Matched on the tag and the number rather than on the skill's name, which keeps this independent
 * of how the page spells a name; a clause stating neither is passed over rather than turned into a
 * requirement at a guessed level.
 */
function readRequirements(paragraph: string): SkillRequirement[] {
  const stated = paragraph.match(STUDY_REQUIREMENT);
  if (!stated) {
    return [];
  }
  return [...stated[1].matchAll(REQUIREMENT_CLAUSE)].map((part) => ({
    tag: part[1],
    level: Number.parseInt(part[2], 10)
  }));
}

/**
 * What a magic skill's own description says about itself. The data page marks magic nowhere - no
 * flag, no grouping, no "may only be studied by a mage" phrase - so the skill's prose is the only
 * evidence there is. Measured over the committed page this separates the catalogue exactly: seventy
 * magic, twenty-six mundane, and the twenty-six are armorer, building, carpenter, combat and their
 * kind.
 *
 * No `g` flag: a global regex keeps `lastIndex` between calls and would match every other skill.
 *
 * The alternatives are grouped behind one `\b` rather than each written `\bword`: alternation binds
 * more loosely than `\b`, so `\bmage|cast` would anchor only `mage` and let `cast` match inside
 * "broadcast" or "outcast". `\b(?:...)` anchors every alternative's left edge alike.
 *
 * `cast` alone still matches inside "Castle" - the fixture has nine of them, none in a magic
 * skill's level-1 paragraph today - because a leading `\b` only rules out mid-word matches, not a
 * real word that happens to start the same way. `(?!le)` is the fixture's actual shape: `cast`,
 * `caster`, `casting` and `CAST` all appear and must keep matching; `castle` must not.
 */
const MAGIC_WORDS = /\b(?:mage|magic|spell|cast(?!le)|summon|enchant|Foundation)/i;

/**
 * "via magic at a cost of 600 silver [SILV]." / "... of sword [SWOR]." / "... of 75 floater
 * hides [FLOA] and 75 ironwood [IRWD]." Stops at the first period: the sentence continues "To use
 * this spell ...", and no input name in the fixture carries a dot of its own.
 */
const CAST_COST = /via magic at a cost of ([^.]+)\./i;
/**
 * One input inside the list `CAST_COST` captures: an optional number, a name, the tag.
 *
 * Global, and read straight out of the clause rather than out of a piece split off it: the pairs
 * are self-delimiting, so `a and b`, `a, b and c` and whatever the page adopts next all read the
 * same, because the separator is never looked at. `readRequirements` was rewritten this way by
 * `ah-6qp` after the same assumption - a fixed separator - shipped a wrong catalogue.
 */
const CAST_INPUT = /(?:(\d+) )?[a-z][a-z ]*\[([A-Z0-9]{2,6})\]/gi;
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
    const stated = [...costMatch[1].matchAll(CAST_INPUT)];
    // A cost sentence naming no input at all is the page having changed shape, and must stay loud:
    // a scraper that reads nothing and says nothing is a worse version of the bug this prevents.
    if (stated.length === 0) {
      throw new RulesetScrapeError(
        `could not read the casting cost of skill ${tag}: "${costMatch[1].trim()}" in "${costMatch[0]}"`
      );
    }
    for (const [, amount, inputTag] of stated) {
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
/**
 * One production inside that clause: everything up to and including its rate phrase.
 *
 * The rate is what ends each production - `at a rate of 1 per man-month`, `... per 3 man-months` -
 * so a global match over the clause yields one production per match, with the rate's two numbers
 * captured rather than discarded. Anything trailing the last rate carries no production and is
 * ignored, as it always was.
 */
const PRODUCTION_SEGMENT = /(.*?)at a rate of (\d+) per (?:(\d+) )?man-months?/gis;
/** The tag in `swords [SWOR]`, `a number of meals [MEAL]`. */
const PRODUCED_TAG = /\[([A-Z0-9]{2,6})\]/;
/**
 * One material inside the ` from ` tail: an optional number, a name, the tag.
 *
 * Global, and read straight out of the tail rather than out of pieces split off it - the same
 * reasoning as `CAST_INPUT`: the pairs are self-delimiting, so `a and b`, `a, b and c` and
 * whatever separator the page adopts next all read alike, because the separator is never looked at.
 */
const PRODUCTION_INPUT = /(?:(\d+) )?[a-z][a-z ]*\[([A-Z0-9]{2,6})\]/gi;
/** `from any of grain [GRAI], livestock [LIVE] and fish [FISH]` - one of the list, not all of it. */
const ANY_OF = /^any of /i;
/** `a number of meals [MEAL] equal to skill level divided by 2, rounded up` - a formula, not a count. */
const FORMULA_OUTPUT = /\bequal to\b/i;

/**
 * What one level's paragraph says the skill may produce, or `[]` when it says nothing - true of
 * most skills.
 *
 * The whole difficulty is telling a product from its materials: `swords [SWOR] from iron [IRON]`
 * names two items and the skill makes only the first. So the clause is cut into one segment per
 * production - the rate phrase is what ends each - and the segment is split at its first ` from `:
 * the head names the product, the tail lists what it consumes. A segment carrying no tag is
 * skipped; a clause that yields no production at all is the page having changed shape, and throws.
 *
 * Cooking says ` from ` twice - `... rounded up from any of grain [GRAI]` - and splitting on the
 * first occurrence happens to give the right answer on both sides. That is luck rather than
 * design, and `data.test.ts` pins it by name.
 */
function readProduction(tag: string, paragraph: string, level: number): Production[] {
  const clause = paragraph.match(PRODUCTION);
  if (!clause) {
    return [];
  }

  const made: Production[] = [];
  for (const segment of clause[1].matchAll(PRODUCTION_SEGMENT)) {
    const [, stated, outputs, manMonths] = segment;
    const [head, ...rest] = stated.split(" from ");
    const found = head.match(PRODUCED_TAG);
    if (!found) {
      continue;
    }

    // Every rate the page states today makes exactly one per period. A page that starts saying
    // "2 per man-month" must stop the scrape rather than be silently read as one - the posture
    // this scraper already takes wherever it cannot read what it was given.
    if (outputs !== "1") {
      throw new RulesetScrapeError(
        `could not read the production rate of skill ${tag} in "${segment[0].trim()}"`
      );
    }

    const tail = rest.join(" from ").trim();
    const inputsAreAlternatives = ANY_OF.test(tail);
    const inputs: ProductionInput[] = [];
    for (const [, amount, inputTag] of tail.replace(ANY_OF, "").matchAll(PRODUCTION_INPUT)) {
      inputs.push({ tag: inputTag, amount: amount === undefined ? 1 : Number.parseInt(amount, 10) });
    }

    made.push({
      tag: found[1],
      level,
      inputs,
      inputsAreAlternatives,
      manMonths: manMonths === undefined ? 1 : Number.parseInt(manMonths, 10),
      outputs: FORMULA_OUTPUT.test(head) ? null : 1
    });
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
/**
 * A skill's level list with this paragraph's level added, when it says anything.
 *
 * The paragraphs arrive in the order the page lists them, which is level order, so appending is
 * all the ordering this needs. A level whose text is the `No skill report.` placeholder, or empty,
 * contributes nothing: keeping it would make the majority of entries read as broken data.
 */
function appendLevel(
  existing: SkillLevel[] | undefined,
  level: number,
  paragraph: string
): SkillLevel[] {
  const description = paragraph.replace(SKILL_OPENING, "").trim();
  const kept = existing ?? [];
  if (description === "" || NO_REPORT.test(description)) {
    return kept;
  }
  return [...kept, { level, description }];
}

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
    // Appended, never overwritten: the page writes a skill once per level and the ruleset holds
    // one entry per skill, so writing rather than appending would leave each skill with only what
    // its last paragraph said - which still looks like a description.
    const levels = appendLevel(existing?.levels, Number.parseInt(level, 10), paragraph);

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
      ),
      // Only the level-1 paragraph is consulted. Higher levels describe what the skill does at
      // that level and mention magic incidentally often enough to matter; level 1 is where a skill
      // says what it is. The `||` is what makes the order the paragraphs arrive in irrelevant: once
      // `magic` is true from an earlier entry, a later, non-level-1 paragraph cannot unset it.
      // Stated on the level-1 entry, so - as with `cost` - whichever entry states them is kept and
      // a later, silent level cannot empty them again.
      requires:
        existing?.requires && existing.requires.length > 0
          ? existing.requires
          : readRequirements(paragraph),
      magic:
        (existing?.magic ?? false) ||
        (Number.parseInt(level, 10) === 1 && MAGIC_WORDS.test(paragraph)),
      ...(levels.length > 0 ? { levels } : {})
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

/** One structure as the data page describes it. */
export type BuildingEntry = {
  /**
   * The description the page gives it, from the name onwards, verbatim and whitespace-collapsed -
   * `This is a building. Units may enter this structure. This trade structure increases the
   * amount of iron available in the region.`
   *
   * Kept because a reference entry that can only show numbers is most of the way to useless
   * (ah-3cj4), and because it is already in front of the parser: the numbers are read out of this
   * very text.
   */
  description: string;
  /** What a trade structure increases the supply of, in the page's own word: `iron`, `yew`. */
  produces?: string;
  /**
   * Men the structure protects - the rules table's "Size". Absent for a Mine, a road or a lair,
   * which state no defence because they give none, and an absent field says that where a `0`
   * would claim the page had said so.
   */
  size?: number;
  /** What building it costs, from the skill that builds it. Absent for anything no skill builds. */
  cost?: number;
  /**
   * What it is built from, in the page's own order. A list because the page offers alternatives -
   * `an Inn from 10 wood [WOOD] or stone [STON]` - which one string cannot hold.
   */
  materials?: string[];
  /**
   * Mages who may study above level 2 inside it. `0` when the entry says nothing: the data page
   * lists every structure and states the capacity wherever there is one, so silence is a
   * statement - and a Tower, which says nothing, really does seat none.
   */
  mages: number;
  /**
   * The tag of the skill that builds it - `BUIL`, `MINI` - taken from the opening of that skill's
   * own entry. Absent for a structure no skill's entry names, which is 22 of the 58: the lairs,
   * and everything the page says cannot be built by players. Absent means the catalogue does not
   * say, never that no skill is needed.
   */
  buildSkill?: string;
  /** The lowest level of `buildSkill` that can build it. Absent exactly when `buildSkill` is. */
  buildLevel?: number;
};

export type BuildingReference = Record<string, BuildingEntry>;

/** What a trade structure increases the supply of, or `null` for anything that is not one. */
function produces(text: string): string | null {
  return (
    text
      .match(/This trade structure increases the amount of ([a-z ]+?) available/i)?.[1]
      .trim() ?? null
  );
}

/** `will allow one mage` is written as a word; every other capacity is a numeral. */
function mageCount(text: string): number {
  const match = text.match(/allow (?:up to )?(one|\d+) mages? to study above level 2/i);
  if (!match) {
    return 0;
  }
  return /^one$/i.test(match[1]) ? 1 : Number.parseInt(match[1], 10);
}

/**
 * Reads the buildings out of the data page: the object entries say what a structure is and how
 * many mages it seats, and the skill entries say what building it costs.
 *
 * Keyed by the object's name upper-cased, the convention `items` and `skills` already use, so a
 * report's printed kind - `Magical Tower` - matches without caring about case.
 */
export function parseBuildingReference(html: string): BuildingReference {
  const paragraphs = entryParagraphs(html);
  const buildings: BuildingReference = {};

  // Pass one: the object entries decide what a building is - every entry that calls itself one,
  // not only the fortifications. The filter that used to stand here kept the ten that state a
  // defence and dropped forty-nine: every trade structure, every road, every lair, which is what
  // ah-3cj4 was filed against. Its stated reason - that a Mine would go from "the catalogue cannot
  // say" to "seats nobody" - does not survive reading the one consumer: `mage_capacity(kind)
  // .is_some_and(|seats| seats >= 1)` is false for `None` and for `Some(0)` alike, so a mage in a
  // Mine is warned either way. `ah-a2k.2`'s warning is unchanged, and pinned by its own tests.
  //
  // A name the page repeats - `Lair`, twice - keeps its last entry, since the map is keyed by the
  // upper-cased name. 59 paragraphs become 58 keys, and neither Lair carries a figure.
  for (const paragraph of paragraphs) {
    // The name may not contain sentence punctuation, for the reason `parseItemReference` records:
    // letting it wander across a full stop matches the tail of the previous sentence.
    const opening = paragraph.match(/^([^.:[\]]{1,40}): This is a building\./);
    if (!opening) {
      continue;
    }

    // The page states size as protection, and that figure equals the rules table's Size for every
    // structure both pages name - which is the evidence for reading it this way. It is an
    // inference, not the page's own word.
    const size = readNumber(paragraph, /provides defense to the first (\d+) men/i);
    const product = produces(paragraph);

    // Only the fields the page actually states. `cost` and `materials` are left for pass two to
    // write, rather than initialised to `0` and `[]`: a lair claiming to cost nothing is exactly
    // the absence-turned-into-a-claim this bead exists to stop.
    buildings[opening[1].trim().toUpperCase()] = {
      description: paragraph.slice(opening[0].length - "This is a building.".length).trim(),
      ...(product === null ? {} : { produces: product }),
      ...(size === null ? {} : { size }),
      mages: mageCount(paragraph)
    };
  }

  // Pass two: the skills say what each costs, and - from the entry's own opening rather than from
  // the BUILD sentence - which skill builds it and at what level. `mining [MINI] 3: ... may BUILD
  // a Mine` states both: the sentence says what is built, the header says who by.
  for (const paragraph of paragraphs) {
    const skill = paragraph.match(SKILL_OPENING);

    for (const statement of paragraph.matchAll(
      /A unit with this skill may BUILD ([^.]+)\./gi
    )) {
      // `a Citadel from 800 stone [STON], a Magical Tower from 10 rootstone [ROOT] or an Inn from
      // 10 wood [WOOD] or stone [STON]` is three clauses, not five: the trailing `or stone [STON]`
      // is another material for the Inn, not another structure. Splitting only before `a`/`an`
      // plus a capital is what tells the two apart. Ships - `Longships [LONG] from 10 wood` -
      // carry no article and so never match a clause at all.
      for (const clause of statement[1].split(/(?:, | or )(?=an? [A-Z])/u)) {
        const built = clause.match(
          /^an? ([^,]+?) from (\d+) ((?:[a-z ]+ \[[A-Z0-9]{2,6}\](?: or )?)+)/
        );
        if (!built) {
          continue;
        }

        const existing = buildings[built[1].trim().toUpperCase()];
        if (!existing) {
          // The object list decides what a building is; a name only a skill mentions is not one.
          continue;
        }

        existing.cost = Number.parseInt(built[2], 10);
        existing.materials = built[3]
          .split(" or ")
          .map((material) => material.replace(/\s*\[[A-Z0-9]{2,6}\]\s*/, "").trim())
          .filter((material) => material.length > 0);

        // Written together or not at all: a requirement with a level of `undefined` compares as
        // `NaN` against a unit's level, which is false for everything - a warning that silently
        // never fires.
        if (skill) {
          existing.buildSkill = skill[2];
          existing.buildLevel = Number.parseInt(skill[3], 10);
        }
      }
    }
  }

  return buildings;
}
