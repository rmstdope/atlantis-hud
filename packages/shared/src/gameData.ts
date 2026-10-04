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

/** The eight lists the dictionary shows, in tab order. */
export type GameDataCategory =
  | "skill"
  | "man"
  | "mount"
  | "ship"
  | "monster"
  | "equipment"
  | "building"
  | "terrain";

/** Tab order, and the order categories are built in. */
export const GAME_DATA_CATEGORIES: readonly GameDataCategory[] = [
  "skill",
  "man",
  "mount",
  "ship",
  "monster",
  "equipment",
  "building",
  // Last, as agreed (ah-yu3j.1): the far right of the strip.
  "terrain"
];

/** What each tab is called. */
export const GAME_DATA_CATEGORY_LABELS: Readonly<Record<GameDataCategory, string>> = {
  skill: "Skills",
  man: "Men",
  mount: "Mounts",
  ship: "Ships",
  monster: "Monsters",
  equipment: "Equipment",
  building: "Buildings",
  terrain: "Terrains"
};

/**
 * What one entry of each category is, as a word: the kind marker on a row of the All tab
 * (ah-yu3j.2), which is what tells crossbow the skill from crossbow the weapon there.
 */
export const GAME_DATA_KIND_WORDS: Readonly<Record<GameDataCategory, string>> = {
  skill: "Skill",
  man: "Man",
  mount: "Mount",
  ship: "Ship",
  monster: "Monster",
  equipment: "Equipment",
  building: "Building",
  terrain: "Terrain"
};

/** One thing in the dictionary, whatever kind it is. */
export type GameDataEntry = {
  /**
   * Unique across every category: `skill:MINI`, `equipment:MITH`, `building:FORT`,
   * `terrain:mountain`.
   */
  id: string;
  category: GameDataCategory;
  /** The display name, e.g. `mining`, `Longship`, `Tower`. */
  name: string;
  /** The four-letter tag, or null for a building or a terrain, which have none. */
  tag: string | null;
};

/** A skill named from somewhere else, with the level that matters there. */
export type GameDataLink = { id: string; name: string; level: number };

/** The skill that settles whether a region holds one item at all, and the level it takes. */
export type RevealingSkill = { skillTag: string; skillName: string; level: number };

/** What a skill's page says at one of its levels. */
export type GameDataLevel = { level: number; description: string };

/** A thing named on another entry's page, followed by clicking it. */
export type GameDataReference = { id: string; name: string };

/**
 * A resource and a terrain that may hold it, either way round, with the percentage of such
 * regions that do (`rules/region_resources`). `chance` is null for a ruleset generated before the
 * percentages were kept, which cannot say how often.
 */
export type TerrainResourceLink = { id: string; name: string; chance: number | null };

/**
 * What entering a terrain costs. `water` is the ocean rule's own terrain and any the world adds,
 * which need a ship unless flying (rules/movement_normal); otherwise a cost per mode of travel.
 */
export type TerrainMovement =
  | { kind: "water" }
  | { kind: "cost"; walk: number; ride: number; fly: number };

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
      /** Derived: the terrains whose resource table holds it, most often first. */
      foundIn: readonly TerrainResourceLink[];
      /** The terrains its description says it prefers to roam; empty for anything else. */
      roams: readonly GameDataReference[];
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
  | {
      kind: "terrain";
      entry: GameDataEntry;
      /** Null when the ruleset carries no movement block. */
      movement: TerrainMovement | null;
      /** What a step along a connected road costs; null for water, or with no movement block. */
      road: number | null;
      /**
       * The resource table's row, in its own order. Null when the table does not cover the
       * terrain - the data is silent there, which is not the same as saying nothing is found.
       */
      foundHere: readonly TerrainResourceLink[] | null;
      /** Every monster whose description says it prefers to roam here, by name. */
      roamingMonsters: readonly GameDataReference[];
    }
  | { kind: "absent"; entry: GameDataEntry };

export type GameDataIndex = {
  entries: readonly GameDataEntry[];
  byId: ReadonlyMap<string, GameDataEntry>;
  /** Raw scraped record for an entry, for the detail pane to read. */
  detailOf: (id: string) => GameDataDetail | null;
  /**
   * Which skill, at which level, can tell whether a region holds an item at all, keyed by the
   * item's tag - `data/skills`' `A unit with this skill is able to determine if a region contains
   * floater hides.`, which nine skill levels state.
   *
   * Empty for a ruleset generated before `ah-rx0r.1` scraped it, which reads as "this catalogue
   * cannot say", never as "nothing here is hidden".
   */
  revealedBy: ReadonlyMap<string, RevealingSkill>;
  /**
   * The item tags each terrain may hold, keyed by the lower-cased terrain word a region report
   * prints, in `rules/region_resources`' own order.
   *
   * Empty, or missing a terrain, for the same reason: the catalogue cannot say.
   */
  terrainResources: ReadonlyMap<string, readonly string[]>;
};

/* --- the scraped shapes, mirroring packages/ruleset/src/data.ts --- */

type RawProduction = { tag: string; level: number; revealsRegion?: boolean };
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
type RawMovement = {
  terrainCosts?: { normal?: number; premiums?: Record<string, number>; premiumFor?: string[] };
  road?: { divisor?: number; minimumCost?: number };
  ocean?: {
    requiresShipUnlessFlying?: boolean;
    flyingMustEndOnLand?: boolean;
    terrain?: string;
    alsoWater?: string[];
  };
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

/** The dictionary id of a terrain, from the word a region report prints: `terrain:mountain`. */
export function terrainEntryId(terrain: string): string {
  return `terrain:${terrain.trim().toLowerCase()}`;
}

/**
 * The terrains a monster's description says it prefers to roam, lower-cased, in its own order.
 *
 * data/grizzly bear: "Monster prefers to roam the mountain terrain."; New Origins also prints
 * "Monster prefers to roam the tunnels, grotto, chasm terrains." Read here rather than scraped into
 * the ruleset: the description already travels for this dialog, and nothing else wants the list.
 */
export function roamingTerrainsOf(description: string | null | undefined): string[] {
  const match = (description ?? "").match(/Monster prefers to roam the ([a-z ,]+?) terrains?\./i);
  if (match === null) {
    return [];
  }
  return match[1]
    .split(",")
    .map((terrain) => terrain.trim().toLowerCase())
    .filter((terrain) => terrain.length > 0);
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

  /**
   * The nine skill levels that state they can determine whether a region holds a resource. A tag
   * claimed twice keeps the lower level - the honest answer to "what does it take to find out".
   */
  const revealedBy = new Map<string, RevealingSkill>();
  for (const [key, skill] of Object.entries(rawSkills)) {
    const skillTag = (skill.tag ?? key).toUpperCase();
    for (const production of skill.produces ?? []) {
      if (production.revealsRegion !== true) {
        continue;
      }
      const itemTag = production.tag.toUpperCase();
      const known = revealedBy.get(itemTag);
      if (known !== undefined && known.level <= production.level) {
        continue;
      }
      revealedBy.set(itemTag, {
        skillTag,
        skillName: skill.name ?? skillTag,
        level: production.level
      });
    }
  }

  /** Permissive like the rest of this parser: anything unreadable is skipped, never thrown on. */
  const terrainResources = new Map<string, readonly string[]>();
  if (isRecord(parsed.terrainResources)) {
    for (const [terrain, tags] of Object.entries(parsed.terrainResources)) {
      if (!Array.isArray(tags)) {
        continue;
      }
      terrainResources.set(
        String(terrain).toLowerCase().trim(),
        tags.map((tag) => String(tag).toUpperCase())
      );
    }
  }

  /** How often, terrain then tag. Missing for a ruleset generated before ah-yu3j.1. */
  const terrainChances = new Map<string, ReadonlyMap<string, number>>();
  if (isRecord(parsed.terrainResourceChances)) {
    for (const [terrain, chances] of Object.entries(parsed.terrainResourceChances)) {
      if (!isRecord(chances)) {
        continue;
      }
      const byTag = new Map<string, number>();
      for (const [tag, chance] of Object.entries(chances)) {
        if (typeof chance === "number") {
          byTag.set(tag.toUpperCase(), chance);
        }
      }
      terrainChances.set(String(terrain).toLowerCase().trim(), byTag);
    }
  }

  /** Every monster's roaming terrains, by its item tag. */
  const roamingByTag = new Map<string, string[]>();
  for (const [key, item] of Object.entries(rawItems)) {
    const terrains = roamingTerrainsOf(item.description);
    if (terrains.length > 0) {
      roamingByTag.set((item.tag ?? key).toUpperCase(), terrains);
    }
  }

  const terrainNames = new Set<string>(terrainResources.keys());
  for (const terrains of roamingByTag.values()) {
    for (const terrain of terrains) {
      terrainNames.add(terrain);
    }
  }
  const terrainEntries: GameDataEntry[] = [...terrainNames].map((terrain) => ({
    id: terrainEntryId(terrain),
    category: "terrain",
    name: terrain,
    tag: null
  }));

  const movement = (isRecord(parsed.movement) ? parsed.movement : null) as RawMovement | null;

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
          : category === "terrain"
            ? terrainEntries
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

  /** The forward direction again: which terrains hold each item, built once. */
  const foundIn = new Map<string, TerrainResourceLink[]>();
  for (const [terrain, tags] of terrainResources) {
    for (const tag of tags) {
      const itemId = findItemId(tag);
      if (itemId === null) {
        continue;
      }
      const list = foundIn.get(itemId) ?? [];
      list.push({
        id: terrainEntryId(terrain),
        name: terrain,
        chance: terrainChances.get(terrain)?.get(tag) ?? null
      });
      foundIn.set(itemId, list);
    }
  }
  for (const list of foundIn.values()) {
    list.sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1) || a.name.localeCompare(b.name));
  }

  /** Every monster that roams each terrain, by name. */
  const roamersOf = (terrain: string): GameDataReference[] =>
    [...roamingByTag]
      .filter(([, terrains]) => terrains.includes(terrain))
      .flatMap(([tag]) => {
        const itemId = findItemId(tag);
        const entry = itemId === null ? undefined : byId.get(itemId);
        return entry === undefined ? [] : [{ id: entry.id, name: entry.name }];
      })
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  /**
   * Water is the ocean rule's terrain and any the world adds, as `Ruleset::is_water` has it in the
   * core; it reads as water here only while the rule actually needs a ship.
   */
  const movementOf = (terrain: string): TerrainMovement | null => {
    const costs = movement?.terrainCosts;
    if (movement === null || costs === undefined || typeof costs.normal !== "number") {
      return null;
    }
    const ocean = movement.ocean;
    const water = [ocean?.terrain ?? "", ...(ocean?.alsoWater ?? [])].some(
      (candidate) => candidate.trim().toLowerCase() === terrain
    );
    if (water && ocean?.requiresShipUnlessFlying === true && ocean.flyingMustEndOnLand === true) {
      return { kind: "water" };
    }
    // `Ruleset::terrain_cost`: the premium applies only to the modes the page names.
    const premium = Object.entries(costs.premiums ?? {}).find(
      ([listed]) => listed.toLowerCase() === terrain
    )?.[1];
    const normal = costs.normal;
    const cost = (mode: string) =>
      premium !== undefined && (costs.premiumFor ?? []).includes(mode) ? premium : normal;
    return { kind: "cost", walk: cost("walk"), ride: cost("ride"), fly: cost("fly") };
  };

  /** `Ruleset::road_cost`: the walking cost divided, rounded down, never below the minimum. */
  const roadOf = (moving: TerrainMovement | null): number | null => {
    const road = movement?.road;
    if (
      moving === null ||
      moving.kind === "water" ||
      road === undefined ||
      typeof road.divisor !== "number" ||
      road.divisor <= 0
    ) {
      return null;
    }
    return Math.max(Math.floor(moving.walk / road.divisor), road.minimumCost ?? 0);
  };

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
          tag: category === "building" || category === "terrain" ? null : (tag ?? null)
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
    if (entry.category === "terrain") {
      const terrain = entry.name;
      const moving = movementOf(terrain);
      const row = terrainResources.get(terrain);
      return {
        kind: "terrain",
        entry,
        movement: moving,
        road: roadOf(moving),
        foundHere:
          row === undefined
            ? null
            : row.map((tag) => {
                const itemId = findItemId(tag);
                return {
                  id: itemId ?? `equipment:${tag}`,
                  name: itemId === null ? tag : (byId.get(itemId)?.name ?? tag),
                  chance: terrainChances.get(terrain)?.get(tag) ?? null
                };
              }),
        roamingMonsters: roamersOf(terrain)
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
      producedBy: producedBy.get(entry.id) ?? [],
      foundIn: foundIn.get(entry.id) ?? [],
      roams: (roamingByTag.get(entry.tag as string) ?? []).map((terrain) => ({
        id: terrainEntryId(terrain),
        name: terrain
      }))
    };
  };

  return { entries, byId, detailOf, revealedBy, terrainResources };
}
