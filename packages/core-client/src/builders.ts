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
import type { StructureInfo } from "./generated/StructureInfo";
import type { VesselEntry } from "./generated/VesselEntry";
import type { UnitSilver } from "./generated/UnitSilver";
import type { TradeRoute, TradedGood } from "./index";

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
    combatSpell: null,
    men: 1,
    menEstimated: false,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null,
    ...overrides
  };
}

/**
 * A structure as the report writes it, with the split fields the parser derives from its kind.
 *
 * A FIXTURE builder: it mirrors `split_kind` (`crates/core/src/report/region.rs`) so a test can
 * name a structure the way a report does — `aStructure("Galley, 40 Galleons")` — instead of
 * spelling out four fields. No production reader splits a kind; that is the whole point of
 * `ah-nmts`, and the parser's own tests live beside `split_kind`.
 */
export function aStructure(kind: string, overrides: Partial<StructureInfo> = {}): StructureInfo {
  const [base, ...clauses] = kind.split(",");
  const qualifiers = clauses.map((clause) => clause.trim()).filter((clause) => clause !== "");
  const vessels = qualifiers.flatMap<VesselEntry>((clause) => {
    const counted = /^(\d+)\s+(.+)$/u.exec(clause);
    if (counted) {
      return [{ count: Number(counted[1]), name: counted[2] }];
    }
    return /^\p{Lu}/u.test(clause) ? [{ count: null, name: clause }] : [];
  });
  return {
    structureId: `${kind}-1`,
    name: base.trim(),
    kind,
    baseKind: base.trim(),
    qualifiers,
    vessels,
    description: null,
    needs: null,
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
    unreadableLines: [],
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
    skills: [],
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

/** Chocolate, bought at (49,3) for $95 and sold at (0,48) for $344 — the ah-1j5 mockup's own row. */
export function aTradedGood(overrides: Partial<TradedGood> = {}): TradedGood {
  return {
    tag: "CHOC",
    name: "chocolate",
    buyPrice: 95,
    sellPrice: 344,
    quantity: 41,
    margin: 249,
    buySeenTurn: null,
    sellSeenTurn: null,
    ...overrides
  };
}

/** The one-way chocolate route from the ah-1j5 mockup: (49,3) → (0,48), worth $10,209. */
export function aTradeRoute(overrides: Partial<TradeRoute> = {}): TradeRoute {
  return {
    from: { x: 49, y: 3, z: 1 },
    to: { x: 0, y: 48, z: 1 },
    outbound: [aTradedGood()],
    inbound: [],
    worth: 10_209,
    turns: { walk: 14, ride: 7, fly: 4 },
    ...overrides
  };
}

/**
 * A unit's silver forecast, all zeroes and nulls: a month in which nothing is earned, nothing is
 * spent and nothing is doubted. Every test that is about a figure sets that figure and leaves the
 * other thirty alone.
 *
 * The unit is the same one `aReportUnit` describes, standing in the same region, so a test can
 * pair them without restating either (ah-uhnd).
 */
export function aUnitSilver(overrides: Partial<UnitSilver> = {}): UnitSilver {
  return {
    unitId: "1",
    regionId: regionIdOf(DEFAULT_COORDINATE),
    held: 0,
    income: 0,
    lateIncome: 0,
    expense: 0,
    atMonthEnd: 0,
    shortForOrders: 0,
    shortOn: null,
    upkeep: 0,
    doubt: null,
    doubtSubject: null,
    received: 0,
    givers: [],
    taken: 0,
    takenFrom: [],
    takenUnshown: 0,
    takenUnshownFrom: [],
    givenToNobody: 0,
    factionFoodCovered: 0,
    ownFoodCovered: 0,
    unclaimedCovered: 0,
    unclaimedContended: false,
    forcedOwnFood: 0,
    forcedOwnFoodTag: null,
    forcedFactionFood: 0,
    foodContended: false,
    sharedSilverCovered: 0,
    sharedSilverForOrders: 0,
    withdrawing: false,
    produced: 0,
    producedName: null,
    productionWanted: 0,
    productionCappedBy: null,
    worksByDefault: false,
    taxesByFlag: false,
    castMade: 0,
    castMadeNamed: null,
    castWanted: 0,
    castCappedBy: null,
    castSummons: false,
    formed: null,
    buyAll: [],
    ...overrides
  };
}
