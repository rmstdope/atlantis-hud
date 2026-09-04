/**
 * Atlantis New Age serves each world's catalogue as JSON, where the standard variant serves an HTML
 * data page. Every entry's `description` is the same sentence the HTML page prints for the
 * equivalent entry, so rather than a second catalogue parser this module renders the JSON back into
 * a data page and lets `data.ts` read it unchanged.
 */

import { RulesetScrapeError } from "./rules";

/** One level of one skill, as the database serves it. */
export type NewAgeSkillLevel = { level: number; description: string };

/** A skill, an item and an object, narrowed to the fields this adapter reads. */
export type NewAgeSkill = { name: string; tag: string; levels: NewAgeSkillLevel[] };
export type NewAgeItem = { name: string; tag: string; description: string };
export type NewAgeObject = { name: string; description: string };

/**
 * One world's catalogue. The served JSON carries more per entry (`category`, `flags`, `weight`,
 * `build`, `defense`, ...); this type names only what `newAgeDataPage` renders, and the rest is
 * ignored rather than refused, so a database that grows a field does not stop the scrape.
 */
export type NewAgeDatabase = {
  world: string;
  skills: NewAgeSkill[];
  items: NewAgeItem[];
  objects: NewAgeObject[];
};

/**
 * `parseItemReference`'s own opening pattern (`data.ts:296`), anchored to a description, and the
 * name and tag shapes `parseSkillReference` (`data.ts:477`) and `parseBuildingReference` need. An
 * entry breaking one of these is *skipped silently* downstream rather than refused, so every
 * section is checked here — a catalogue quietly one entry short is the failure these convert into a
 * message.
 */
const ITEM_OPENING = /^[^.:[\]]{1,40} \[[A-Z0-9]{2,6}\][,.] /;
const ENTRY_NAME = /^[^.:[\]]{1,40}$/;
const ENTRY_TAG = /^[A-Z0-9]{2,6}$/;

const WRAP_COLUMNS = 72;
const CONTINUATION_INDENT = "  ";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function section(value: unknown, world: string, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new RulesetScrapeError(`the ${world} database has no ${name} section`);
  }
  return value;
}

function asRecord(value: unknown, world: string, name: string, index: number): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RulesetScrapeError(`the ${world} database has a ${name} entry at index ${index} that is not an object`);
  }
  return value as Record<string, unknown>;
}

function readSkill(raw: unknown, world: string, index: number): NewAgeSkill {
  const entry = asRecord(raw, world, "skills", index);
  const where = isNonEmptyString(entry.tag) ? entry.tag : `index ${index}`;
  if (!isNonEmptyString(entry.name) || !isNonEmptyString(entry.tag)) {
    throw new RulesetScrapeError(`the ${world} database has a skill at ${where} with no name or tag`);
  }
  if (!ENTRY_NAME.test(entry.name) || !ENTRY_TAG.test(entry.tag)) {
    throw new RulesetScrapeError(
      `the ${world} database has a skill ${entry.tag} whose name or tag a skill entry cannot carry`
    );
  }
  if (!Array.isArray(entry.levels) || entry.levels.length === 0) {
    throw new RulesetScrapeError(`the ${world} database has a skill ${entry.tag} with no levels`);
  }
  const levels = entry.levels.map((rawLevel, levelIndex) => {
    const level = asRecord(rawLevel, world, `skill ${entry.tag} levels`, levelIndex);
    if (
      typeof level.level !== "number" ||
      !Number.isInteger(level.level) ||
      level.level < 0 ||
      !isNonEmptyString(level.description)
    ) {
      throw new RulesetScrapeError(
        `the ${world} database has a level of skill ${entry.tag} with no whole level number or description`
      );
    }
    return { level: level.level, description: level.description };
  });
  return { name: entry.name, tag: entry.tag, levels };
}

function readItem(raw: unknown, world: string, index: number): NewAgeItem {
  const entry = asRecord(raw, world, "items", index);
  const where = isNonEmptyString(entry.tag) ? entry.tag : `index ${index}`;
  if (!isNonEmptyString(entry.name) || !isNonEmptyString(entry.tag)) {
    throw new RulesetScrapeError(`the ${world} database has an item at ${where} with no name or tag`);
  }
  if (!isNonEmptyString(entry.description) || !ITEM_OPENING.test(entry.description)) {
    throw new RulesetScrapeError(
      `the ${world} database has an item ${entry.tag} whose description does not open with its name and tag`
    );
  }
  return { name: entry.name, tag: entry.tag, description: entry.description };
}

function readObject(raw: unknown, world: string, index: number): NewAgeObject {
  const entry = asRecord(raw, world, "objects", index);
  const where = isNonEmptyString(entry.name) ? entry.name : `index ${index}`;
  if (!isNonEmptyString(entry.name) || !ENTRY_NAME.test(entry.name)) {
    throw new RulesetScrapeError(`the ${world} database has an object at ${where} with no usable name`);
  }
  if (!isNonEmptyString(entry.description)) {
    throw new RulesetScrapeError(`the ${world} database has an object ${entry.name} with no description`);
  }
  return { name: entry.name, description: entry.description };
}

/** Reads the served JSON. Throws `RulesetScrapeError` naming what was missing or malformed. */
export function parseNewAgeDatabase(json: string): NewAgeDatabase {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RulesetScrapeError("the New Age database is not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new RulesetScrapeError("the New Age database is not JSON naming a world");
  }
  const database = parsed as Record<string, unknown>;
  if (!isNonEmptyString(database.world)) {
    throw new RulesetScrapeError("the New Age database names no world");
  }
  const world = database.world;
  return {
    world,
    skills: section(database.skills, world, "skills").map((raw, index) => readSkill(raw, world, index)),
    items: section(database.items, world, "items").map((raw, index) => readItem(raw, world, index)),
    objects: section(database.objects, world, "objects").map((raw, index) => readObject(raw, world, index))
  };
}

/**
 * Wraps on spaces only, never inside a word: a word longer than the limit gets its own over-long
 * line rather than being split, since a broken tag would stop the entry being read at all.
 */
function wrap(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let indent = "";
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    const candidate = current.length === 0 ? indent + word : `${current} ${word}`;
    if (current.length > 0 && candidate.length > WRAP_COLUMNS) {
      lines.push(current);
      indent = CONTINUATION_INDENT;
      current = indent + word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

/**
 * `preformattedText` strips `<...>` before it decodes entities, so an unescaped `<dir>` in a spell's
 * syntax would be deleted as though it were markup. Escaping happens after wrapping, so the wrap
 * counts the characters a reader sees.
 */
function escape(line: string): string {
  return line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders a database as a data page in the shape `preformattedText` reads: one `<pre>` block, the
 * three `Skill reports:` / `Item reports:` / `Object reports:` headings at column 0, one entry per
 * paragraph starting at column 0 with continuation lines indented, blank lines between.
 */
export function newAgeDataPage(database: NewAgeDatabase): string {
  const lines: string[] = ["<pre>"];
  const push = (entry: string) => {
    for (const line of wrap(entry)) {
      lines.push(escape(line));
    }
    lines.push("");
  };

  lines.push("Skill reports:", "");
  for (const skill of database.skills) {
    for (const level of skill.levels) {
      push(`${skill.name} [${skill.tag}] ${level.level}: ${level.description}`);
    }
  }

  lines.push("Item reports:", "");
  for (const item of database.items) {
    push(item.description);
  }

  lines.push("Object reports:", "");
  for (const object of database.objects) {
    push(`${object.name}: ${object.description}`);
  }

  lines.push("</pre>", "");
  return lines.join("\n");
}
