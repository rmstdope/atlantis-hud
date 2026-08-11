/**
 * What a hex shows, prepared once for whichever theme draws it.
 *
 * This is the whole of the map's shared knowledge about a hex: a theme decides *how* to draw, and
 * this decides *what* there is to draw. Two things follow from that split and are worth naming:
 *
 * - **The layer chips are applied here, once.** A view built with the units chip off has no units
 *   in it at all, so a theme cannot forget to honour a toggle - there is nothing left to forget.
 * - **Nothing is left for a theme to compute.** Age is already a fog opacity, a road is already a
 *   bearing, and the structures are already sorted into what each one is drawn as. Six themes
 *   re-deriving any of that would be six chances to derive it differently.
 *
 * Pure, so every decision can be tested without a renderer.
 */

import type { ReportRegion, ReportUnit, StructureInfo } from "@atlantis/core-client";
import type { HexKnowledge, HexNode } from "../../hexMapModel";
import { worldOf } from "../mapViewport";
import { hexPaint, terrainTexturePatternId, terrainTextureUrl } from "../mapHexView";

/**
 * The monster faction, whose units are wandering hazards rather than somebody's army.
 *
 * This is the faction id the report prints, and it is not the same signal the movement risk engine
 * uses (`crates/core/src/movement/risk.rs` reads the ruleset's item kinds). A monster whose faction
 * line is concealed parses with no faction id at all, so the risk panel can warn about a hex this
 * counts as holding none.
 */
export const MONSTER_FACTION_ID = "2";

/** The six ways a road can run out of a flat-top hex. */
export type RoadDirection = "n" | "ne" | "se" | "s" | "sw" | "nw";

/**
 * Where each road direction's edge midpoint lies, as a unit vector from the hex's centre.
 *
 * Flat-top hexes put the six edge midpoints at 0.87R along exactly these six bearings, which are
 * also the six directions an Atlantis road can run.
 */
export const ROAD_VECTORS: Record<RoadDirection, { x: number; y: number }> = {
  n: { x: 0, y: -1 },
  ne: { x: 0.866, y: -0.5 },
  se: { x: 0.866, y: 0.5 },
  s: { x: 0, y: 1 },
  sw: { x: -0.866, y: 0.5 },
  nw: { x: -0.866, y: -0.5 }
};

const ROAD_DIRECTIONS = new Set<string>(Object.keys(ROAD_VECTORS));

/**
 * Whether a structure can sail away: a ship is drawn as a hull, not as a building's roof. The
 * report offers no flag for this, only the kind's name, so the classic hull names are listed and
 * "ship"/"boat" catch the rest (Longship, Airship, Longboat and their kin).
 */
const SHIP_KINDS = new Set(["galley", "raft", "cog", "clipper", "galleon", "corsair", "balloon"]);

/**
 * A passage to another level. Shafts are the only non-magical way between the surface and the
 * underworld, so they anchor all inter-level route planning and deserve their own mark.
 */
const SHAFT_KINDS = new Set(["shaft"]);

/**
 * An unenterable monster habitat. These monsters never wander but can attack whatever stands in
 * the hex - a standing danger, distinct from the monster faction's roaming units.
 */
const LAIR_KINDS = new Set(["lair", "cave", "ruin", "ruins", "barrow", "crypt", "tomb", "pit"]);

export type SettlementTier = "village" | "town" | "city";

const SETTLEMENT_TIERS = new Set<string>(["village", "town", "city"]);

export type HexView = {
  /** The hex's region id, which is also its React key. */
  key: string;
  /** Where the hex's centre sits in world space, so a theme needs no geometry of its own. */
  at: { x: number; y: number };
  terrain: string;
  /** The biome image to paint under the theme's own treatment, or null when textures are off. */
  texture: { url: string; patternId: string } | null;
  /** How much unexplored ground shows through, which is how age is drawn. */
  fogOpacity: number;
  /** Whether the hex is also hatched, marking the data as held but possibly out of date. */
  hatched: boolean;
  knowledge: HexKnowledge;
  ageInTurns: number | null;
  roads: RoadDirection[];
  /** `tier` is null when the town's name is known but its size is not. */
  settlement: { name: string; tier: SettlementTier | null } | null;
  /**
   * Unit counts, not head counts. `foreign` is the whole foreign tally and `monster` says how many
   * of those belong to the monster faction, so a theme that does not draw monsters separately
   * still shows everybody standing in the hex.
   */
  units: { own: number; foreign: number; monster: number };
  /** Who holds the hex, own guards reported ahead of anyone else's. */
  guard: "own" | "foreign" | null;
  ships: number;
  buildings: number;
  shafts: number;
  lairs: number;
  /**
   * Reserved. Every theme's layout keeps a slot for a battle and for a gate; both turn true when
   * the parser learns to read them, and no layout changes when they do.
   */
  battle: boolean;
  gate: boolean;
};

export type HexViewOptions = {
  showStaleness: boolean;
  showTextures: boolean;
  showUnits: boolean;
  showStructures: boolean;
};

/** The bearing a road structure runs along, or null for any other kind of structure. */
function roadDirection(kind: string): RoadDirection | null {
  const match = /^road\s+(\w+)$/iu.exec(kind.trim());
  if (!match) {
    return null;
  }
  const direction = match[1].toLowerCase();
  return ROAD_DIRECTIONS.has(direction) ? (direction as RoadDirection) : null;
}

function isShip(kind: string): boolean {
  const name = kind.trim().toLowerCase();
  return SHIP_KINDS.has(name) || name.includes("ship") || name.includes("boat");
}

/** What a structure is drawn as. Every structure is exactly one of these. */
type StructureKind = "road" | "ship" | "shaft" | "lair" | "building";

function classify(structure: StructureInfo): StructureKind {
  const kind = structure.kind.trim().toLowerCase();
  if (roadDirection(structure.kind) !== null) {
    return "road";
  }
  if (isShip(structure.kind)) {
    return "ship";
  }
  if (SHAFT_KINDS.has(kind)) {
    return "shaft";
  }
  if (LAIR_KINDS.has(kind)) {
    return "lair";
  }
  return "building";
}

type StructureTally = {
  roads: RoadDirection[];
  ships: number;
  shafts: number;
  lairs: number;
  buildings: number;
};

/**
 * Built fresh each time rather than shared.
 *
 * A view model is data handed to a theme nobody has written yet, and one `view.roads.sort()` in a
 * future theme would otherwise reorder the roads of every hex on the level at once.
 */
function noStructures(): StructureTally {
  return { roads: [], ships: 0, shafts: 0, lairs: 0, buildings: 0 };
}

function tallyStructures(region: ReportRegion | null): StructureTally {
  const tally = noStructures();
  for (const structure of region?.structures ?? []) {
    switch (classify(structure)) {
      case "road": {
        const direction = roadDirection(structure.kind);
        if (direction) {
          tally.roads.push(direction);
        }
        break;
      }
      case "ship":
        tally.ships += 1;
        break;
      case "shaft":
        tally.shafts += 1;
        break;
      case "lair":
        tally.lairs += 1;
        break;
      default:
        tally.buildings += 1;
    }
  }
  return tally;
}

/**
 * The biome image to paint under the theme's own treatment.
 *
 * Worked out only when textures are asked for: with the toggle off this runs for every hex on
 * screen to produce a null, and it lowercases the terrain word and probes a set to do it.
 */
function textureOf(terrain: string): { url: string; patternId: string } | null {
  const url = terrainTextureUrl(terrain);
  const patternId = terrainTexturePatternId(terrain);
  return url && patternId ? { url, patternId } : null;
}

/**
 * The town's tier, or null when the report never said.
 *
 * A hex named by a neighbour's exits carries the settlement's name and nothing else about it, and
 * guessing "village" there would draw a hut over what may be a city.
 */
function settlementOf(hex: HexNode): { name: string; tier: SettlementTier | null } | null {
  const name = hex.settlementName;
  if (name === null) {
    return null;
  }
  const size = hex.region?.settlement?.size?.trim().toLowerCase() ?? null;
  return { name, tier: size && SETTLEMENT_TIERS.has(size) ? (size as SettlementTier) : null };
}

function countMonsters(units: ReportUnit[]): number {
  return units.filter((unit) => !unit.own && unit.factionId === MONSTER_FACTION_ID).length;
}

/**
 * Who stands on guard.
 *
 * Own guards are reported ahead of anyone else's: "am I on guard here" is the question a player
 * asks of their own map first, and guarding blocks taxation, theft and hostile movement either way.
 */
function guardOf(units: ReportUnit[]): "own" | "foreign" | null {
  if (units.some((unit) => unit.onGuard && unit.own)) {
    return "own";
  }
  return units.some((unit) => unit.onGuard) ? "foreign" : null;
}

export function buildHexView(hex: HexNode, options: HexViewOptions): HexView {
  const paint = hexPaint(hex, options.showStaleness);
  const structures = options.showStructures ? tallyStructures(hex.region) : noStructures();
  const units = hex.region?.units ?? [];

  return {
    key: hex.regionId,
    at: worldOf(hex.coordinate),
    terrain: hex.terrain,
    texture: options.showTextures ? textureOf(hex.terrain) : null,
    fogOpacity: paint.fogOpacity,
    hatched: paint.hatched,
    knowledge: hex.knowledge,
    ageInTurns: hex.ageInTurns,
    roads: structures.roads,
    settlement: settlementOf(hex),
    units: options.showUnits
      ? { own: hex.ownUnitCount, foreign: hex.foreignUnitCount, monster: countMonsters(units) }
      : { own: 0, foreign: 0, monster: 0 },
    guard: options.showUnits ? guardOf(units) : null,
    ships: structures.ships,
    buildings: structures.buildings,
    shafts: structures.shafts,
    lairs: structures.lairs,
    battle: false,
    gate: false
  };
}

export function buildHexViews(hexes: HexNode[], options: HexViewOptions): HexView[] {
  return hexes.map((hex) => buildHexView(hex, options));
}
