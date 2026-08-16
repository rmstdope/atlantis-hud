/**
 * Builders for the report model, for tests anywhere in the workspace.
 *
 * Each returns a complete, self-consistent value with every field set, and takes a shallow
 * `Partial<T>` of overrides — a test names only the fields it is about, and a field added to the
 * Rust model (and so to the generated types) is set once here and in no test file (ah-164.3).
 *
 * The defaults describe one small world, the same one the turn-diff tests already used: faction 95
 * "Borg TNG", turn 71 (December, Year 6), the mountain at (7,53) in Inhead, and a one-man unit
 * called Scouts standing in it. A test that asserts on one of these values passes it explicitly
 * all the same — the defaults are a convenience, not a contract.
 *
 * Overrides are spread last and shallowly: `aReportRegion({ units: [u] })` has exactly `[u]`,
 * and nested values are built with the nested builder, `aParsedReport({ header: aReportHeaderInfo({ … }) })`.
 * Naming rule: `a` + the exact type name.
 */
import type { Battle } from "./generated/Battle";
import type { BattleUnit } from "./generated/BattleUnit";
import type { Coordinate } from "./generated/Coordinate";
import type { ParsedReport } from "./generated/ParsedReport";
import type { ReportHeaderInfo } from "./generated/ReportHeaderInfo";
import type { ReportRegion } from "./generated/ReportRegion";
import type { ReportUnit } from "./generated/ReportUnit";

/** The mountain at (7,53) on the surface, where the default unit stands. */
const DEFAULT_COORDINATE: Coordinate = { x: 7, y: 53, z: 1 };

/** `z:x,y` — the spelling of Rust `Coordinate::id` and of `hexMapModel.regionIdOf`. */
function regionIdOf(coordinate: Coordinate): string {
  return `${coordinate.z}:${coordinate.x},${coordinate.y}`;
}

export function aReportUnit(overrides: Partial<ReportUnit> = {}): ReportUnit {
  return {
    unitId: "1",
    name: "Scouts",
    regionId: regionIdOf(DEFAULT_COORDINATE),
    factionId: "95",
    factionName: "Borg TNG",
    own: true,
    onGuard: false,
    flags: [],
    items: [],
    skills: [],
    men: 1,
    menEstimated: false,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null,
    ...overrides
  };
}

/** `regionId` follows `coordinate` unless both are given. */
export function aReportRegion(overrides: Partial<ReportRegion> = {}): ReportRegion {
  const coordinate = overrides.coordinate ?? DEFAULT_COORDINATE;
  return {
    regionId: regionIdOf(coordinate),
    coordinate,
    terrain: "mountain",
    province: "Inhead",
    settlement: null,
    population: null,
    race: null,
    taxBase: null,
    wages: null,
    maxWages: null,
    entertainment: null,
    products: [],
    wanted: [],
    forSale: [],
    exits: [],
    structures: [],
    units: [],
    ...overrides
  };
}

export function aReportHeaderInfo(overrides: Partial<ReportHeaderInfo> = {}): ReportHeaderInfo {
  return {
    factionId: "95",
    factionName: "Borg TNG",
    factionTypes: [],
    month: "December",
    year: 6,
    turnNumber: 71,
    engineVersion: null,
    ruleset: null,
    rulesetVersion: null,
    unclaimedSilver: null,
    errors: [],
    events: [],
    factionStatus: { entries: [], unparsed: [] },
    attitudes: { defaultAttitude: null, levels: [] },
    ...overrides
  };
}

export function aParsedReport(overrides: Partial<ParsedReport> = {}): ParsedReport {
  return {
    header: aReportHeaderInfo(),
    regions: [],
    battles: [],
    ordersTemplate: null,
    ...overrides
  };
}

export function aBattleUnit(overrides: Partial<BattleUnit> = {}): BattleUnit {
  return {
    name: "Scouts",
    id: "1",
    faction: { name: "Borg TNG", id: "95" },
    flags: [],
    body: "1 man",
    ...overrides
  };
}

/**
 * The turn-71 fixture's first battle (`AA Tomb's Guards (7280) attacks Pirates (14789) in ocean
 * (25,55)`), with empty rosters, rounds and casualties — the two battle tests already start from it.
 */
export function aBattle(overrides: Partial<Battle> = {}): Battle {
  return {
    headline: "AA Tomb's Guards (7280) attacks Pirates (14789) in ocean (25,55) in Atlantis Ocean!",
    attacker: { name: "AA Tomb's Guards", id: "7280" },
    defender: { name: "Pirates", id: "14789" },
    terrain: "ocean",
    coordinate: { x: 25, y: 55, z: 1 },
    province: "Atlantis Ocean",
    attackers: [],
    defenders: [],
    rounds: [],
    statistics: [],
    casualties: [],
    damagedUnits: [],
    spoils: null,
    lineStart: 10,
    lineEnd: 200,
    assassination: false,
    ...overrides
  };
}
