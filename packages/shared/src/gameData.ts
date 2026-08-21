/**
 * The game data dictionary: the scraped ruleset, parsed once into something the interface can
 * browse.
 *
 * The ruleset has always been held as raw JSON text and handed straight to the Rust core, so this
 * is the first place TypeScript reads inside it. The shapes below mirror
 * `packages/ruleset/src/data.ts`; they are declared here rather than imported because
 * `@atlantis/ruleset` is not a dependency of this package, does not export its skill or building
 * types, and names its own `Ruleset` the same as the unrelated one in `./rulesets`.
 */

/** The seven lists the dictionary shows, in tab order. */
export type GameDataCategory =
  | "skill"
  | "man"
  | "mount"
  | "ship"
  | "monster"
  | "equipment"
  | "building";

/** Tab order, and the order categories are built in. */
export const GAME_DATA_CATEGORIES: readonly GameDataCategory[] = [
  "skill",
  "man",
  "mount",
  "ship",
  "monster",
  "equipment",
  "building"
];

/** What each tab is called. */
export const GAME_DATA_CATEGORY_LABELS: Readonly<Record<GameDataCategory, string>> = {
  skill: "Skills",
  man: "Men",
  mount: "Mounts",
  ship: "Ships",
  monster: "Monsters",
  equipment: "Equipment",
  building: "Buildings"
};

/** One thing in the dictionary, whatever kind it is. */
export type GameDataEntry = {
  /** Unique across every category: `skill:MINI`, `equipment:MITH`, `building:FORT`. */
  id: string;
  category: GameDataCategory;
  /** The display name, e.g. `mining`, `Longship`, `Tower`. */
  name: string;
  /** The four-letter tag, or null for a building, which has none. */
  tag: string | null;
};

/** A skill named from somewhere else, with the level that matters there. */
export type GameDataLink = { id: string; name: string; level: number };

/** What a skill's page says at one of its levels. */
export type GameDataLevel = { level: number; description: string };

/** What the detail pane renders. One variant per shape the scrape actually has. */
export type GameDataDetail =
  | {
      kind: "skill";
      entry: GameDataEntry;
      cost: number | null;
      maxLevel: number;
      magic: boolean;
      description: string | null;
      levels: readonly GameDataLevel[];
      produces: readonly GameDataLink[];
      requires: readonly GameDataLink[];
    }
  | {
      kind: "item";
      entry: GameDataEntry;
      weight: number;
      moves: number;
      capacity: { walk: number; ride: number; fly: number; swim: number };
      selfMobile: { walk: boolean; ride: boolean; fly: boolean; swim: boolean };
      combat: {
        skill: number;
        attacksPerRound: number;
        hitsToKill: number;
        damagePerAttack: number;
      } | null;
      cargoCapacity: number | null;
      sailingSkill: number | null;
      capacityCondition: string | null;
      description: string | null;
      /** Derived: the skills that produce this item, and at what level. */
      producedBy: readonly GameDataLink[];
    }
  | {
      kind: "building";
      entry: GameDataEntry;
      size: number | null;
      cost: number | null;
      materials: readonly string[];
      mages: number;
      produces: string | null;
      description: string | null;
      /**
       * The skill that builds this, as the ruleset's tag - `BUIL`, `MINI` - and the level it takes.
       * Null on the 22 of 58 structures that are not buildable at all: a lair, a ruin, a monolith.
       */
      buildSkill: string | null;
      buildLevel: number | null;
    }
  | { kind: "absent"; entry: GameDataEntry };

export type GameDataIndex = {
  entries: readonly GameDataEntry[];
  byId: ReadonlyMap<string, GameDataEntry>;
  /** Raw scraped record for an entry, for the detail pane to read. */
  detailOf: (id: string) => GameDataDetail | null;
};

/* --- the scraped shapes, mirroring packages/ruleset/src/data.ts --- */

type RawProduction = { tag: string; level: number };
type RawSkill = {
  tag: string;
  name: string;
  cost: number | null;
  maxLevel: number;
  produces?: RawProduction[];
  requires?: RawProduction[];
  magic?: boolean;
  levels?: GameDataLevel[];
  description?: string;
};
type RawItem = {
  tag: string;
  name: string;
  kind: string;
  weight: number;
  moves: number;
  capacity: { walk: number; ride: number; fly: number; swim: number };
  selfMobile: { walk: boolean; ride: boolean; fly: boolean; swim: boolean };
  combat?: { skill: number; attacksPerRound: number; hitsToKill: number; damagePerAttack: number };
  cargoCapacity?: number;
  sailingSkill?: number;
  capacityCondition?: string;
  description?: string;
};
type RawBuilding = {
  description?: string;
  produces?: string;
  size?: number;
  cost?: number;
  materials?: string[];
  mages?: number;
  buildSkill?: string;
  buildLevel?: number;
};

const ITEM_KINDS: readonly string[] = ["man", "mount", "monster", "ship", "equipment"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `MAGICAL CASTLE` reads as `Magical Castle`, which is how the rules page writes it. */
function titleCase(key: string): string {
  return key
    .toLowerCase()
    .split(" ")
    .map((word) => (word === "" ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function byName(a: GameDataEntry, b: GameDataEntry): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/** The dictionary id of a skill, from the tag a report or the ruleset uses. */
export function skillEntryId(tag: string): string {
  return `skill:${tag.toUpperCase()}`;
}

/**
 * The dictionary id of an item, which needs the index because an item's category is its `kind`
 * and that is not knowable from the tag alone. Null when no item carries the tag.
 */
export function itemEntryId(index: GameDataIndex, tag: string): string | null {
  const wanted = tag.toUpperCase();
  for (const category of ITEM_KINDS) {
    const id = `${category}:${wanted}`;
    if (index.byId.has(id)) {
      return id;
    }
  }
  return null;
}

/**
 * The dictionary id of a structure, from the kind a report names it by. `buildings` is keyed by
 * the upper-cased name, so `Fort` becomes `building:FORT`; a kind the scrape never took yields an
 * id whose `detailOf` reports it absent rather than throwing.
 */
export function buildingEntryId(kind: string): string {
  return `building:${kind.toUpperCase()}`;
}

/**
 * The dictionary id a structure's kind names, ships first and buildings second (ah-t5fk).
 *
 * A structure's kind can be either — `Galley` is a ship, `Fort` is a building — and only the
 * catalogue knows which, so it is asked rather than a list of vessel words being kept beside it.
 * `SHIP_KINDS` in `hexView.ts` is deliberately NOT consulted: ah-lcyn is a whole bead about an
 * enumerated word list failing on the kind nobody listed.
 *
 * Plural spellings are tried the way `isKeyword` (`orderCase.ts`) does, mirroring the Rust core's
 * `item_spellings`: the word AS WRITTEN first, then without a trailing `ES`, then without a
 * trailing `S`. A report writes `40 Galleons`; the entry is `Galleon`. As-written comes first so a
 * vessel whose real name ends in `s` is found before anything is stripped from it.
 *
 * Falls back to the building id, which is what it has always been: a kind the scrape never took
 * still yields an id whose `detailOf` reports it absent, and saying so is the point of landing
 * there (ah-5jkt.2).
 *
 * A linear scan over the ship entries — a few hundred entries, a handful of links per pane — rather
 * than a name index built at parse time, which would put a second map in every parsed ruleset for a
 * lookup this rare.
 */
export function structureEntryId(index: GameDataIndex, kind: string): string {
  const wanted = kind.trim().toUpperCase();
  const spellings = [wanted];
  if (wanted.endsWith("ES")) spellings.push(wanted.slice(0, -2));
  if (wanted.endsWith("S")) spellings.push(wanted.slice(0, -1));
  for (const spelling of spellings) {
    const ship = index.entries.find(
      (entry) => entry.category === "ship" && entry.name.toUpperCase() === spelling
    );
    if (ship) {
      return ship.id;
    }
  }
  return buildingEntryId(kind);
}

/** Parses the ruleset text. Returns null when the text is not a ruleset at all. */
export function parseGameData(rulesetText: string): GameDataIndex | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rulesetText);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.skills) || !isRecord(parsed.items)) {
    return null;
  }
  const rawSkills = parsed.skills as Record<string, RawSkill>;
  const rawItems = parsed.items as Record<string, RawItem>;
  const rawBuildings = (isRecord(parsed.buildings) ? parsed.buildings : {}) as Record<
    string,
    RawBuilding
  >;

  const entries: GameDataEntry[] = [];
  const byId = new Map<string, GameDataEntry>();
  const add = (entry: GameDataEntry) => {
    entries.push(entry);
    byId.set(entry.id, entry);
  };

  const skillEntries: GameDataEntry[] = [];
  for (const [key, skill] of Object.entries(rawSkills)) {
    const tag = (skill.tag ?? key).toUpperCase();
    skillEntries.push({ id: skillEntryId(tag), category: "skill", name: skill.name ?? tag, tag });
  }

  const itemsByCategory = new Map<GameDataCategory, GameDataEntry[]>();
  for (const [key, item] of Object.entries(rawItems)) {
    const category = (ITEM_KINDS.includes(item.kind) ? item.kind : "equipment") as GameDataCategory;
    const tag = (item.tag ?? key).toUpperCase();
    const list = itemsByCategory.get(category) ?? [];
    list.push({ id: `${category}:${tag}`, category, name: item.name ?? tag, tag });
    itemsByCategory.set(category, list);
  }

  const buildingEntries: GameDataEntry[] = Object.keys(rawBuildings).map((key) => ({
    id: buildingEntryId(key),
    category: "building",
    name: titleCase(key),
    tag: null
  }));

  for (const category of GAME_DATA_CATEGORIES) {
    const list =
      category === "skill"
        ? skillEntries
        : category === "building"
          ? buildingEntries
          : (itemsByCategory.get(category) ?? []);
    for (const entry of [...list].sort(byName)) {
      add(entry);
    }
  }

  /** An item's id from its tag, without the public entry point's need for a finished index. */
  const findItemId = (tag: string): string | null => {
    const wanted = tag.toUpperCase();
    for (const category of ITEM_KINDS) {
      const id = `${category}:${wanted}`;
      if (byId.has(id)) {
        return id;
      }
    }
    return null;
  };

  /** The forward direction is all the scrape holds, so the reverse link is built once, here. */
  const producedBy = new Map<string, GameDataLink[]>();
  for (const entry of skillEntries) {
    const skill = rawSkills[entry.tag as string] ?? rawSkills[entry.name];
    for (const production of skill?.produces ?? []) {
      const itemId = findItemId(production.tag);
      if (itemId === null) {
        continue;
      }
      const list = producedBy.get(itemId) ?? [];
      list.push({ id: entry.id, name: entry.name, level: production.level });
      producedBy.set(itemId, list);
    }
  }

  const linkToSkill = (reference: RawProduction): GameDataLink => {
    const id = skillEntryId(reference.tag);
    return { id, name: byId.get(id)?.name ?? reference.tag, level: reference.level };
  };

  const detailOf = (id: string): GameDataDetail | null => {
    const entry = byId.get(id);
    if (entry === undefined) {
      const [category, tag] = id.split(":");
      if (!GAME_DATA_CATEGORIES.includes(category as GameDataCategory)) {
        return null;
      }
      return {
        kind: "absent",
        entry: {
          id,
          category: category as GameDataCategory,
          name: category === "building" ? titleCase(tag ?? "") : (tag ?? ""),
          tag: category === "building" ? null : (tag ?? null)
        }
      };
    }
    if (entry.category === "skill") {
      const skill = rawSkills[entry.tag as string];
      if (skill === undefined) {
        return { kind: "absent", entry };
      }
      return {
        kind: "skill",
        entry,
        cost: skill.cost ?? null,
        maxLevel: skill.maxLevel ?? 0,
        magic: skill.magic === true,
        description: skill.description ?? null,
        levels: skill.levels ?? [],
        produces: (skill.produces ?? []).map((production) => {
          const itemId = findItemId(production.tag);
          return {
            id: itemId ?? `equipment:${production.tag.toUpperCase()}`,
            name: itemId === null ? production.tag : (byId.get(itemId)?.name ?? production.tag),
            level: production.level
          };
        }),
        requires: (skill.requires ?? []).map(linkToSkill)
      };
    }
    if (entry.category === "building") {
      const building = rawBuildings[(entry.name || "").toUpperCase()] ?? rawBuildings[id.slice(9)];
      if (building === undefined) {
        return { kind: "absent", entry };
      }
      return {
        kind: "building",
        entry,
        size: building.size ?? null,
        cost: building.cost ?? null,
        materials: building.materials ?? [],
        mages: building.mages ?? 0,
        produces: building.produces ?? null,
        description: building.description ?? null,
        buildSkill: building.buildSkill ?? null,
        buildLevel: building.buildLevel ?? null
      };
    }
    const item = rawItems[entry.tag as string];
    if (item === undefined) {
      return { kind: "absent", entry };
    }
    return {
      kind: "item",
      entry,
      weight: item.weight ?? 0,
      moves: item.moves ?? 0,
      capacity: item.capacity ?? { walk: 0, ride: 0, fly: 0, swim: 0 },
      selfMobile: item.selfMobile ?? { walk: false, ride: false, fly: false, swim: false },
      combat: item.combat ?? null,
      cargoCapacity: item.cargoCapacity ?? null,
      sailingSkill: item.sailingSkill ?? null,
      capacityCondition: item.capacityCondition ?? null,
      description: item.description ?? null,
      producedBy: producedBy.get(entry.id) ?? []
    };
  };

  return { entries, byId, detailOf };
}
