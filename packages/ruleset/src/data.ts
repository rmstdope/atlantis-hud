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

export type { BuildingEntry } from "./generated/BuildingEntry";
export type { CastCost } from "./generated/CastCost";
export type { CastInput } from "./generated/CastInput";
export type { CastOutput } from "./generated/CastOutput";
export type { ControlCap } from "./generated/ControlCap";
export type { SkillEntry } from "./generated/SkillEntry";
export type { SkillLevel } from "./generated/SkillLevel";
export type { SkillRequirement } from "./generated/SkillRequirement";
export type { ItemCapacity } from "./generated/ItemCapacity";
export type { ItemEntry } from "./generated/ItemEntry";
export type { ItemKind } from "./generated/ItemKind";
export type { MonsterCombat } from "./generated/MonsterCombat";
export type { Production } from "./generated/Production";
export type { ProductionInput } from "./generated/ProductionInput";
export type { SelfMobility } from "./generated/SelfMobility";
export type { Weapon } from "./generated/Weapon";

import type { BuildingEntry } from "./generated/BuildingEntry";
import type { SkillEntry } from "./generated/SkillEntry";
import type { SkillLevel } from "./generated/SkillLevel";
import type { SkillRequirement } from "./generated/SkillRequirement";
import type { CastCost } from "./generated/CastCost";
import type { CastInput } from "./generated/CastInput";
import type { CastOutput } from "./generated/CastOutput";
import type { ControlCap } from "./generated/ControlCap";
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

/**
 * The maintenance value the data page gives a food item, as a spreadable field so a non-food item
 * carries no key. A positive integer in this exact clause is the sole food discriminator: nothing
 * is inferred from tags, names, item classes, or the bare word "eaten".
 *
 * The rules page (`rules/economy_maintenance`) and the data page disagree - the rules section says
 * one food substitutes for each 50 silver, while `data/GRAI`, `data/LIVE`, `data/FISH` and
 * `data/MEAL` each state 30 here. `ah-773o` resolved it in favour of this per-item value, which the
 * committed turn-17 report corroborates. This scraper reads what the data page states and no more.
 */
function maintenanceOf(paragraph: string): { maintenanceValue?: number } {
  const value = readNumber(
    paragraph,
    /can be eaten to provide (\d+) silver towards a unit's maintenance cost/i
  );
  return value === null ? {} : { maintenanceValue: value };
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
      ...maintenanceOf(paragraph),
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
 * Which of `rules/give`'s classes an entry's own paragraph states it belongs to, matched against
 * `entry.description` - already collapsed to a single line by `entryParagraphs`.
 *
 * `NORMAL` is not here: it is read from `withdrawCost`, not from prose, because `prose` drops the
 * preamble the withdrawal sentence lives in. `MAN` and `SHIP` are not here either, since `kind`
 * already answers them more reliably than a second pattern could - a centaur is `kind === "man"`
 * and a flying ship's `'ship'` phrasing is already handled by `classify`. `WEAPON` reads the
 * `weapon` block rather than prose, for the same reason.
 */
const CLASS_MARKERS: Record<string, RegExp> = {
  TRADE: /This is a trade good\./i,
  MONSTER: /This is a monster\.|This is a free-moving-item \(FMI\)\./i,
  ARMOR: /This is a type of armor\./i,
  MOUNT: /This is a mount\./i,
  BATTLE: /This item is a miscellaneous combat item\./i,
  TOOL: /This is a tool\./i,
  FOOD: /This item can be eaten to provide/i
};

/** `silver [SILV], weight 0. This is the currency of Atlantis.` - NORMAL's other member. */
const CURRENCY = /This is the currency of/i;

/** `This item cannot be given to other units.` */
const UNGIVEABLE = /This item cannot be given to other units\./i;

/**
 * Which items belong to each class `GIVE [unit] ALL [item class]` accepts (`rules/give`), read off
 * the finished entries rather than the page a second time, so a class can lean on a fact already
 * scraped - `kind` for MAN and SHIP, the `weapon` block for WEAPON - instead of a second pattern
 * that could disagree with the first.
 *
 * A class with no members is an absent key, not an empty array: the conservative reading is
 * "cannot say" rather than "you have none", the same direction `classify` already refuses to guess
 * in. `ADVANCED`, `MAGIC` and `SPECIAL` are never printed by the engine in any form, so they are
 * always absent. `ITEM`/`ITEMS` is "the combination of all of the previous categories" and needs
 * no catalogue, so it is never emitted either.
 *
 * `NORMAL` is withheld unless some item on the page states a withdrawal price: its marker rides on
 * this game having withdrawal enabled, and a page with it off would otherwise leave NORMAL looking
 * like a one-item class containing silver alone - a confident wrong answer rather than an absent
 * one.
 */
export function itemClassesOf(items: ItemReference): Record<string, string[]> {
  const classes: Record<string, string[]> = {};

  const record = (key: string, members: string[]) => {
    if (members.length > 0) {
      classes[key] = members.sort();
    }
  };

  const entries = Object.values(items);

  for (const [key, marker] of Object.entries(CLASS_MARKERS)) {
    record(
      key,
      entries.filter((entry) => marker.test(entry.description ?? "")).map((entry) => entry.tag)
    );
  }

  record(
    "MAN",
    entries.filter((entry) => entry.kind === "man").map((entry) => entry.tag)
  );
  record(
    "SHIP",
    entries.filter((entry) => entry.kind === "ship").map((entry) => entry.tag)
  );
  record(
    "WEAPON",
    entries.filter((entry) => entry.weapon !== undefined).map((entry) => entry.tag)
  );

  if (entries.some((entry) => entry.withdrawCost !== undefined)) {
    record(
      "NORMAL",
      entries
        .filter((entry) => entry.withdrawCost !== undefined || CURRENCY.test(entry.description ?? ""))
        .map((entry) => entry.tag)
    );
  }

  return classes;
}

/**
 * The tags whose entry says `This item cannot be given to other units.`, sorted.
 *
 * Read off the finished entries like `itemClassesOf`, from `description`, so the two new blocks
 * are built the same way from the same input.
 */
export function ungiveableItemsOf(items: ItemReference): string[] {
  return Object.values(items)
    .filter((entry) => UNGIVEABLE.test(entry.description ?? ""))
    .map((entry) => entry.tag)
    .sort();
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

/**
 * Reading the data page's `[TAG]` clauses.
 *
 * Every one of these is matched globally, straight out of the whole clause, and **never looks at a
 * separator**. The `[TAG]` pairs delimit themselves, so `a and b`, `a, b and c` and whatever the
 * page adopts next all read alike. Assuming a separator has shipped a wrong catalogue twice -
 * `ah-6qp` lost ENGR's energy shield by splitting on ` and `, and `ah-bet5` fixed the same
 * assumption in the casting costs three days later - and a third copy of the same loop was written
 * by hand after both (`ah-19l2.1`). Hence one home (`ah-3rxk`).
 */

/** One `N name [TAG]` pair: the count, defaulting to 1 where the page states a bare name. */
export type TaggedAmount = { tag: string; amount: number };

const TAGGED_AMOUNT = /(?:(\d+) )?[a-z][a-z ]*\[([A-Z0-9]{2,6})\]/gi;

/** Every `N name [TAG]` in a clause, in the order the page wrote them. */
export function taggedAmounts(clause: string): TaggedAmount[] {
  return [...clause.matchAll(TAGGED_AMOUNT)].map(([, amount, tag]) => ({
    tag,
    amount: amount === undefined ? 1 : Number.parseInt(amount, 10)
  }));
}

/** One `name [TAG] N` pair, where `N` is a skill level rather than a count. */
export type TaggedLevel = { tag: string; level: number };

const TAGGED_LEVEL = /\[([A-Z0-9]{2,6})\]\s+(\d+)/g;

/** Every `name [TAG] N` in a clause. A clause stating no level is passed over, not guessed at. */
export function taggedLevels(clause: string): TaggedLevel[] {
  return [...clause.matchAll(TAGGED_LEVEL)].map(([, tag, level]) => ({
    tag,
    level: Number.parseInt(level, 10)
  }));
}


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
  return taggedLevels(stated[1]);
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
 * Whether a spell damages enemies, which is one of the four ways the rules let a unit TAX - and so
 * one of the ways its men count toward PILLAGE's threshold (`ah-v585`). The data page marks it
 * nowhere, so it is read from the skill's own description, exactly as `magic` is.
 *
 * "deals N damage" is the discriminator, and it is chosen because it separates cleanly on the
 * committed fixture where looser patterns do not:
 *
 *   matches 8 - FIRE, EQUA, STOR, CALL, SBLA, BUND, BDEM, DISP
 *   the four shields say "shield against all ranged attacks" and match nothing here
 *   the four summons say the creatures "aid in battle" and match nothing here
 *
 * A pattern on `attack` or `battle` would have caught both groups. Deliberately excluded: FEAR and
 * SSTO, cast at enemies but stating no damage - under-counting, which costs a missing warning
 * rather than a false one. Deliberately included: BUND, BDEM and DISP, which damage only undead,
 * demons and illusions; they damage enemies when those enemies are present, and the rules draw no
 * distinction.
 */
const DAMAGES_ENEMIES = /\bdeals? \d+ damage\b/i;

/**
 * "via magic at a cost of 600 silver [SILV]." / "... of sword [SWOR]." / "... of 75 floater
 * hides [FLOA] and 75 ironwood [IRWD]." Stops at the first period: the sentence continues "To use
 * this spell ...", and no input name in the fixture carries a dot of its own.
 */
const CAST_COST = /via magic at a cost of ([^.]+)\./i;
/** "the attempt costs 1000 silver." (Construct Gate) */
const ATTEMPT_COST = /the attempt costs (\d+) silver/i;
/** "2 stone [STON] times the skill level into rootstone [ROOT]" - the source and what it becomes. */
const TRANSMUTE = /(\d+) [a-z ]+ \[([A-Z0-9]{2,6})\] times the skill level into [a-z ]+ \[([A-Z0-9]{2,6})\]/gi;
/** "may create 5 times their level in mithril swords [MSWO]" - a count per level, with a number. */
const CREATES_TIMES_LEVEL = /may create (\d+) times their level in ([^.[]*)\[([A-Z0-9]{2,6})\]/i;
/** "may create their level in amulets of protection [AMPR]" - the same shape, meaning one per level. */
const CREATES_ONE_PER_LEVEL = /may create their level in ([^.[]*)\[([A-Z0-9]{2,6})\]/i;
/** "has a 20 percent times their level chance to create a ring of invisibility [RING]". */
const CREATES_BY_CHANCE =
  /(\d+) percent times (?:their|his|her|its) (?:skill )?level chance to create ([^.[]*)\[([A-Z0-9]{2,6})\]/i;
/** "100 percent times his skill level minus 2 eagles per month" - bird lore alone. */
const CREATION_LEVEL_OFFSET = /percent times (?:their|his|her|its) skill level minus (\d+)/i;
/**
 * The three creation clauses with the item taken out, so a page that states a creation this parser
 * cannot finish reading stops the scrape rather than silently recording nothing - the same posture
 * `readCastCost` already takes for a cost clause naming no input.
 */
const CREATION_STATED =
  /may create (?:\d+ times )?their level in |percent times (?:their|his|her|its) (?:skill )?level chance to create /i;

/** `averaging 200 percent`, `an average of 100 percent`, `at an average rate of 200 percent`. */
const CREATION_AVERAGED = /\baverag(?:ing|e of|e rate of)\b/i;
/** The nine summoning skills, from their prose rather than the normalised sentence. */
const CREATION_SUMMONED = /\b(?:may|can) summon\b|\bchance (?:of summoning|to summon)\b/i;
/** `control a total number of his skill level squared times 4 wolves`. */
const CONTROL_SQUARED_TIMES =
  /control a total number of (?:his|her|their|its) skill level squared times (\d+)/i;
/** `may control a number equal to his skill level minus 2, squared, times two`. */
const CONTROL_OFFSET_SQUARED =
  /control a number equal to (?:his|her|their|its) skill level minus (\d+), squared, times (two|three|four|\d+)/i;
/** `the total number of dragons that a mage may control at one time is equal to his skill level`. */
const CONTROL_EQUALS_LEVEL =
  /may control at one time is equal to (?:his|her|their|its) skill level/i;
/** `may only summon a balrog if one is not already under his control` - a flat cap of one. */
const CONTROL_ONLY_ONE =
  /may only summon [a-z ]+ if one is not already under (?:his|her|their|its) control/i;
/**
 * Any sentence about controlling a number, with the four shapes above taken out, so a page that
 * states a cap this parser cannot read stops the scrape rather than silently recording none - the
 * same posture `readCastCost` already takes for a cost clause naming no input.
 */
const CONTROL_STATED = /\b(?:may|can) control\b|\bunder (?:his|her|their|its) control\b/i;

/** `two` -> 2, `three` -> 3, `four` -> 4; anything else parsed as a plain number. */
function wordOrNumber(word: string): number {
  switch (word) {
    case "two":
      return 2;
    case "three":
      return 3;
    case "four":
      return 4;
    default:
      return Number.parseInt(word, 10);
  }
}

/**
 * Reads the control cap a paragraph states for a summoned creature, or `null` when it states none -
 * true of five of the nine summons and every non-summon creation.
 *
 * Runs only when the paragraph has already been found to state a creation: `data/BIRD` level 1 is
 * about scouting and says "the mage can control small birds of the sky" while creating nothing, and
 * an unconditional guard would throw on it.
 */
function readControlCap(paragraph: string): ControlCap | null {
  const squaredTimes = paragraph.match(CONTROL_SQUARED_TIMES);
  if (squaredTimes) {
    return { multiplier: Number.parseInt(squaredTimes[1], 10), offset: 0, exponent: 2 };
  }
  const offsetSquared = paragraph.match(CONTROL_OFFSET_SQUARED);
  if (offsetSquared) {
    return {
      multiplier: wordOrNumber(offsetSquared[2]),
      offset: -Number.parseInt(offsetSquared[1], 10),
      exponent: 2
    };
  }
  if (CONTROL_EQUALS_LEVEL.test(paragraph)) {
    return { multiplier: 1, offset: 0, exponent: 1 };
  }
  if (CONTROL_ONLY_ONE.test(paragraph)) {
    return { multiplier: 1, offset: 0, exponent: 0 };
  }
  return null;
}

/**
 * Reads what a single level's paragraph says CASTing the skill consumes, or `null` when it says
 * nothing - true of most spells (summons, lores, combat effects state no cost at all).
 *
 * An input inside the `CAST_COST` list that `taggedAmounts` cannot read throws rather than being
 * silently dropped: the page has changed shape, and a cost quietly missing is exactly the failure
 * this catalogue exists to prevent - see `RulesetScrapeError`.
 */
function readCastCost(tag: string, paragraph: string, level: number): CastCost | null {
  const costs: CastInput[] = [];

  const costMatch = paragraph.match(CAST_COST);
  if (costMatch) {
    const stated = taggedAmounts(costMatch[1]);
    // A cost sentence naming no input at all is the page having changed shape, and must stay loud:
    // a scraper that reads nothing and says nothing is a worse version of the bug this prevents.
    if (stated.length === 0) {
      throw new RulesetScrapeError(
        `could not read the casting cost of skill ${tag}: "${costMatch[1].trim()}" in "${costMatch[0]}"`
      );
    }
    costs.push(...stated);
  }

  const attemptCost = readNumber(paragraph, ATTEMPT_COST);
  if (attemptCost !== null) {
    costs.push({ tag: "SILV", amount: attemptCost });
  }

  const creates: CastOutput[] = [];

  const averaged = CREATION_AVERAGED.test(paragraph);
  const summoned = CREATION_SUMMONED.test(paragraph);
  const control = readControlCap(paragraph);

  const transmute: Record<string, string> = {};
  for (const match of paragraph.matchAll(TRANSMUTE)) {
    const [, perLevel, source, output] = match;
    transmute[output] = source;
    creates.push({
      tag: output,
      level,
      percentPerLevel: Number.parseInt(perLevel, 10) * 100,
      levelOffset: 0,
      averaged,
      summoned,
      control
    });
  }

  const timesLevel = paragraph.match(CREATES_TIMES_LEVEL);
  const onePerLevel = paragraph.match(CREATES_ONE_PER_LEVEL);
  const byChance = paragraph.match(CREATES_BY_CHANCE);
  const offsetMatch = paragraph.match(CREATION_LEVEL_OFFSET);
  const levelOffset = offsetMatch ? -Number.parseInt(offsetMatch[1], 10) : 0;
  if (timesLevel) {
    creates.push({
      tag: timesLevel[3],
      level,
      percentPerLevel: Number.parseInt(timesLevel[1], 10) * 100,
      levelOffset,
      averaged,
      summoned,
      control
    });
  } else if (onePerLevel) {
    creates.push({
      tag: onePerLevel[2],
      level,
      percentPerLevel: 100,
      levelOffset,
      averaged,
      summoned,
      control
    });
  } else if (byChance) {
    creates.push({
      tag: byChance[3],
      level,
      percentPerLevel: Number.parseInt(byChance[1], 10),
      levelOffset,
      averaged,
      summoned,
      control
    });
  } else if (CREATION_STATED.test(paragraph)) {
    // A creation sentence the three shapes above could not finish reading is the page having
    // changed shape, and must stay loud - the same posture `readCastCost` already takes for a
    // cost clause naming no input.
    throw new RulesetScrapeError(`could not read what skill ${tag} creates in "${paragraph}"`);
  }

  // A control-cap sentence this parser cannot read is the page having changed shape, and must stay
  // loud - but only once a creation has actually been found: `data/BIRD` level 1 states no
  // creation at all while still talking about controlling small birds.
  const statedCreation = creates.length > 0;
  if (statedCreation && control === null && CONTROL_STATED.test(paragraph)) {
    throw new RulesetScrapeError(
      `could not read the control cap skill ${tag} states in "${paragraph}"`
    );
  }

  if (costs.length === 0 && Object.keys(transmute).length === 0 && creates.length === 0) {
    return null;
  }
  return { costs, transmute, creates };
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
 * production - the rate phrase is what ends each - and the segment is split at its last ` from `:
 * the head names the product, the tail lists what it consumes. A segment carrying no tag is
 * skipped; a clause that yields no production at all is the page having changed shape, and throws.
 *
 * The cut is the segment's LAST ` from `, because the material list is what the final one
 * introduces - a sentence that says ` from ` twice, as cooking's shape does, keeps its formula
 * phrase in the head where `FORMULA_OUTPUT` can see it (`ah-3rxk`, which replaced a
 * first-occurrence split that gave the right answer by luck).
 */
function readProduction(tag: string, paragraph: string, level: number): Production[] {
  const clause = paragraph.match(PRODUCTION);
  if (!clause) {
    return [];
  }

  const made: Production[] = [];
  for (const segment of clause[1].matchAll(PRODUCTION_SEGMENT)) {
    const [, stated, outputs, manMonths] = segment;
    // The LAST " from ", not the first: the materials are what the final one introduces, in both
    // the one-`from` and the two-`from` shapes (`ah-3rxk`).
    const cut = stated.lastIndexOf(" from ");
    const head = cut === -1 ? stated : stated.slice(0, cut);
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

    const tail = cut === -1 ? "" : stated.slice(cut + " from ".length).trim();
    const inputsAreAlternatives = ANY_OF.test(tail);
    const inputs: ProductionInput[] = taggedAmounts(tail.replace(ANY_OF, ""));

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

/**
 * Unions two `CastCost`s across levels: `costs` from whichever level states them, `transmute`
 * merged, and `creates` concatenated with a tag already seen dropped - the paragraphs arrive in
 * level order, so the first paragraph to state a tag is the one kept.
 */
function mergeCast(existing: CastCost | null | undefined, found: CastCost | null): CastCost | null {
  if (!existing) {
    return found;
  }
  if (!found) {
    return existing;
  }
  return {
    costs: existing.costs.length > 0 ? existing.costs : found.costs,
    transmute: { ...existing.transmute, ...found.transmute },
    creates: [
      ...existing.creates,
      ...found.creates.filter((made) => !existing.creates.some((seen) => seen.tag === made.tag))
    ]
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
      cast: mergeCast(existing?.cast, readCastCost(tag, paragraph, Number.parseInt(level, 10))),
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
      // Level-1 only and `||`-accumulated, for the same reasons `magic` is.
      damagesEnemies:
        (existing?.damagesEnemies ?? false) ||
        (Number.parseInt(level, 10) === 1 && DAMAGES_ENEMIES.test(paragraph)),
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
