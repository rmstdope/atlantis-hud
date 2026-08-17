import type { AdvisoryCheckCode } from "./coreVocabulary.generated";

// The report model and the parse family are generated from the Rust core by ts-rs
// (crates/core, `cargo test`); see docs/implementation-plan.md §Generated bindings.
export type { EngineInfo } from "./generated/EngineInfo";
export type { TurnRef } from "./generated/TurnRef";
export type { TurnTouch } from "./generated/TurnTouch";
export type { WarningSeverity } from "./generated/WarningSeverity";
export type { ParseWarning } from "./generated/ParseWarning";
export type { TurnHeader } from "./generated/TurnHeader";
export type { FactionInfo } from "./generated/FactionInfo";
export type { RegionSummary } from "./generated/RegionSummary";
export type { UnitSummary } from "./generated/UnitSummary";
export type { InventoryItem } from "./generated/InventoryItem";
export type { MessageSummary } from "./generated/MessageSummary";
export type { ReportParseResult } from "./generated/ReportParseResult";
export type { Coordinate } from "./generated/Coordinate";
export type { ItemAmount } from "./generated/ItemAmount";
export type { MarketItem } from "./generated/MarketItem";
export type { SettlementInfo } from "./generated/SettlementInfo";
export type { RegionExit } from "./generated/RegionExit";
export type { StructureInfo } from "./generated/StructureInfo";
export type { SkillInfo } from "./generated/SkillInfo";
export type { ReportUnit } from "./generated/ReportUnit";
export type { ReportRegion } from "./generated/ReportRegion";
export type { ReportHeaderInfo } from "./generated/ReportHeaderInfo";
export type { FactionStatus } from "./generated/FactionStatus";
export type { FactionStatusEntry } from "./generated/FactionStatusEntry";
export type { DeclaredAttitudes } from "./generated/DeclaredAttitudes";
export type { AttitudeLevel } from "./generated/AttitudeLevel";
export type { FactionRef } from "./generated/FactionRef";
export type { UnitOrders } from "./generated/UnitOrders";
export type { OrdersTemplate } from "./generated/OrdersTemplate";
export type { Combatant } from "./generated/Combatant";
export type { BattleUnit } from "./generated/BattleUnit";
export type { Casualty } from "./generated/Casualty";
export type { BattleRound } from "./generated/BattleRound";
export type { Battle } from "./generated/Battle";
export type { ParsedReport } from "./generated/ParsedReport";
export type { OrderDiagnosticSeverity } from "./generated/OrderDiagnosticSeverity";
export type { OrderDiagnostic } from "./generated/OrderDiagnostic";
export type { OrderValidationResult } from "./generated/OrderValidationResult";

export {
  aBattle,
  aBattleUnit,
  aParsedReport,
  aReportHeaderInfo,
  aReportRegion,
  aReportUnit,
  aTradeRoute,
  aTradedGood
} from "./builders";

import type { Coordinate } from "./generated/Coordinate";
import type { ReportRegion } from "./generated/ReportRegion";
import type { ReportUnit } from "./generated/ReportUnit";
import type { SettlementInfo } from "./generated/SettlementInfo";
import type { ReportParseResult } from "./generated/ReportParseResult";
import type { OrderValidationResult } from "./generated/OrderValidationResult";
import type { EngineInfo } from "./generated/EngineInfo";
import type { ParsedReport } from "./generated/ParsedReport";

export type GameMetadata = {
  gameId: string;
  gameName: string;
  /**
   * Which ruleset the game is played under, by identifier.
   *
   * The rules themselves are a served file handed to the core per call, so a game records which
   * one it wants rather than a copy of it.
   */
  rulesetId: string;
  /**
   * Which faction in this game is the player's, if one has been chosen yet.
   *
   * Optional rather than `string | null` because it is genuinely absent on a game created before
   * this field existed: the browser stores the manifest object as it stands, so an old record has
   * no such key at all.
   */
  activeFactionId?: string | null;
};

export type ReportSourceRef = {
  sourceId: string;
  label: string;
};

export type GameManifest = {
  manifestVersion: number;
  metadata: GameMetadata;
  reportSources: ReportSourceRef[];
  /** ISO 8601. */
  createdAt: string;
  /**
   * ISO 8601, rewritten every time the game is opened.
   *
   * This decides which game reopens on the next launch. It lives on each game rather than in an
   * index beside them, so there is no second copy to fall out of step.
   */
  lastOpenedAt: string;
};

export type OpenedGame = {
  gameFilePath: string;
  databasePath: string;
  schemaVersion: number;
  manifest: GameManifest;
};



/** One of the six ways out of a hex, as the core names them. */
export type Direction =
  | "north"
  | "northeast"
  | "southeast"
  | "south"
  | "southwest"
  | "northwest";

/** One hex entered along a route. */
export type RouteStep = {
  direction: Direction;
  to: Coordinate;
  terrain: string;
  cost: number;
  /** Whether a road connected both sides and halved the cost. */
  road: boolean;
  /**
   * Whether the terrain and the cost are guesses rather than anything a report stated.
   *
   * True for a step into unexplored country, which the core costs as the terrain of the hex behind
   * it. Nothing about such a step is knowledge, and the interface has to say so.
   */
  estimated: boolean;
};

/** Where the unit stands when a month runs out. */
export type MonthLeg = { month: number; steps: number; endsAt: Coordinate };

export type RoutePlan = {
  from: Coordinate;
  to: Coordinate;
  mode: "fly" | "ride" | "sail" | "walk";
  steps: RouteStep[];
  totalCost: number;
  months: MonthLeg[];
  /** The order this route becomes, as core writes it - `SAIL …` for a fleet, `MOVE …` for everyone else. */
  order: string;
};

/**
 * Why a route could not be planned.
 *
 * Always a named reason rather than a bare failure: "the sea is in the way at (8,52)" is something
 * a player can act on, where "no route" is not.
 */
export type RouteProblem =
  | { kind: "notYourUnit" }
  | { kind: "overloaded" }
  | { kind: "mobilityUnstated" }
  | { kind: "alreadyThere" }
  | { kind: "noKnownRoute" }
  | { kind: "originUnknown" }
  | { kind: "oceanNeedsShip"; coordinate: Coordinate }
  | { kind: "flightWouldEndOverOcean"; coordinate: Coordinate }
  | { kind: "crewCannotSail"; required: number; available: number };

export type RiskLevel = "low" | "medium" | "high";

export type HexRisk = {
  coordinate: Coordinate;
  level: RiskLevel;
  hostileStrength: number;
  ownStrength: number;
  foreignUnits: number;
  monsters: number;
  guards: number;
  /** Whether the hex could be assessed at all. An unassessable hex is never reported as safe. */
  unknown: boolean;
  lastSeenTurn: number | null;
  reason: string;
};

/** A route is as dangerous as its worst hex, never an average of them. */
export type RouteRisk = { level: RiskLevel; worst: HexRisk | null; hexes: HexRisk[] };

/** One good worth carrying from one hex to another. */
export type TradedGood = {
  /** The item's tag, as both markets name it. */
  tag: string;
  /** The seller's own spelling, which is what the region panel shows. */
  name: string;
  buyPrice: number;
  sellPrice: number;
  /** The smaller of what the seller has and what the buyer will take. */
  quantity: number;
  /** `sellPrice - buyPrice`, per unit. */
  margin: number;
  /** The turn each half was last seen in, so a rumour can say so. `null` only when the report
   * carries no turn number at all. */
  buySeenTurn: number | null;
  sellSeenTurn: number | null;
};

/**
 * How long the journey takes, in months, for each way of travelling. `null` where the known map
 * offers that mode no route at all - water for a walker, or a gap in what has been seen.
 */
export type TravelTurns = { walk: number | null; ride: number | null; fly: number | null };

/** A pair of hexes worth trading between, and everything worth carrying either way. */
export type TradeRoute = {
  /** Where the journey starts: the hex whose outbound leg is worth at least as much as the
   * other way (a tie keeps the lower-indexed hex, for a stable answer). */
  from: Coordinate;
  to: Coordinate;
  /** Goods bought at `from` and sold at `to`. Never empty. */
  outbound: TradedGood[];
  /** Goods bought at `to` and sold at `from`. Empty unless the way back also pays, which is what
   * makes this a circuit rather than a one-way trip. */
  inbound: TradedGood[];
  /** Silver earned running the whole thing once: every good on both legs, quantity times margin. */
  worth: number;
  turns: TravelTurns;
};

/**
 * One region the faction saw in an earlier turn.
 *
 * `region` is a `ReportRegion` with its exits intact, which is what lets an accumulated map join up
 * into a graph a route can cross. A single report describes its neighbours but not theirs.
 */
export type RememberedRegion = { region: ReportRegion; lastSeenTurn: number };

/**
 * What a map export puts in the file, beyond the region economy every export carries.
 *
 * Three levers rather than a detail level, because the reasons for holding something back differ:
 * units say where your army is, structures say what you have built, and advanced resources say
 * where the mithril is. A player trading a map usually wants to give away only some of that.
 */
export type MapExportContent = {
  structures: boolean;
  units: boolean;
  advancedResources: boolean;
};

/**
 * One rectangle of one level, and what to write about it.
 *
 * The corners are inclusive and may arrive in either order: they come from a drag on the map,
 * which says nothing about which corner the player started from.
 */
export type MapExportRequest = {
  level: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  content: MapExportContent;
};

/**
 * How much can be trusted about a hex on the accumulated map - the same three words the core's
 * resolver uses.
 */
export type HexKnowledge = "current" | "stale" | "named";

/** One hex, resolved by the core: what is known about it, and since when. */
export type KnownMapHex = {
  coordinate: Coordinate;
  terrain: string;
  province: string;
  knowledge: HexKnowledge;
  lastSeenTurn: number | null;
  /** `null` for a hex merely named by an exit, never visited. */
  region: ReportRegion | null;
  /** The settlement the hex's description names, if any. */
  settlement: SettlementInfo | null;
};

/** One level the known map has hexes on, with the word the level control shows for it. */
export type MapLevel = {
  z: number;
  name: string;
};

/** Everything the faction knows about the map, resolved once by the core. */
export type KnownMap = {
  /** Sorted by level, then row, then column. */
  hexes: KnownMapHex[];
  /** The distinct levels `hexes` holds, ascending by z, each named by the core. */
  levels: MapLevel[];
  currentTurn: number | null;
};

/**
 * One allied report folded into a faction's map for one turn.
 *
 * Merging writes the ally's regions under the viewer's own faction id and stores no turn of the
 * ally's, so afterwards nothing else in the game says where the extra hexes came from. `factionId`
 * is the map that grew; `mergedFactionId` is whose report grew it.
 */
export type MergedReportRecord = {
  gameId: string;
  factionId: string;
  turnNumber: number;
  mergedFactionId: string;
  mergedFactionName: string;
  mergedAt: string;
};

/** What merging one allied report did to a faction's map. */
export type ReportMergeResult = {
  turnNumber: number;
  mergedFactionId: string;
  mergedFactionName: string;
  /** Regions the allied report contributed. */
  mergedRegionCount: number;
  /** Of those, the hexes that were new to the map. */
  newRegionCount: number;
};

/**
 * Where a unit's written MOVE order takes it, hex by hex and month by month.
 *
 * Terrain is a guess wherever the map could not say, and the trace never refuses: an order into
 * unexplored country is extrapolated to its end, because it is still the player's stated intent.
 */
export type TracedPath = {
  from: Coordinate;
  steps: RouteStep[];
  /** Empty when `mode` is null - the timing cannot be split without knowing the unit's speed. */
  months: MonthLeg[];
  /** How the unit travels, or null when it is overloaded or the report never said. */
  mode: "fly" | "ride" | "sail" | "walk" | null;
  /**
   * Index of the first step the game would refuse - a walker entering the sea - or null when the
   * whole path is passable or there is no mode to rule with. Everything from this step onward is
   * doubt rather than plan, whatever month it falls in.
   */
  blockedFrom: number | null;
};

/** The traced order, or nothing when the unit has no readable movement order to draw. */
export type MoveOrderTraceResponse = {
  path: TracedPath | null;
};

/** How a previewed unit relates to the hex its row sits in. */
export type UnitPreviewStatus = "present" | "departing" | "arriving" | "formed";

/** One field the orders change, with what the report said before, formatted for a tooltip. */
export type FieldChange = {
  /** The `ReportUnit` field: `name`, `onGuard`, `flags`, `items`, `men` or `structureId`. */
  field: string;
  original: string;
};

/** One unit as the orders leave it: the full predicted state, so the row renders like any other. */
export type UnitPreview = {
  unit: ReportUnit;
  status: UnitPreviewStatus;
  changes: FieldChange[];
  /** Where an arriving unit set out from. */
  arrivingFrom: string | null;
  /** Where a departing unit ends the month, when the trace can say. */
  departingTo: string | null;
  /**
   * The fleet carrying this unit away, as `<name> [<id>]`, when it is departing because the ship it
   * stands in is. Never set on an arriving row: an arrival says only where it came from.
   */
  aboard: string | null;
};

/** Every previewed unit standing in (or bound for) one region. */
export type RegionPreview = {
  regionId: string;
  units: UnitPreview[];
};

/**
 * What the orders document changes, region by region. Regions and units the orders leave alone
 * are absent, so an empty answer means the report already shows the coming month.
 */
export type OrdersPreviewResponse = {
  regions: RegionPreview[];
};

/** Everything the planner has to say about one proposed move. */
export type RoutePlanResponse = {
  /** The route, when one was found. */
  plan: RoutePlan | null;
  /** Why there is none, when there is not. Exactly one of these two is present. */
  problem: RouteProblem | null;
  /** What stands along it. Present only alongside a route. */
  risk: RouteRisk | null;
  /** False while the ruleset has an open gap, which makes the cost a lower bound. */
  fullyModelled: boolean;
};

/** One entry in the orders editor's completion popup, mirroring the core's `OrderCompletion`. */
export type OrderCompletion = {
  /** What is written into the line when the entry is accepted, and the first thing the typed word
   * is matched against. Always the canonical spelling: a keyword, or an item or skill tag. */
  value: string;
  /** The other thing the typed word may match: an item's or skill's name. Empty for a keyword. */
  name: string;
  /** What the entry shows beside its value. Empty for a keyword, which is its own explanation. */
  detail: string;
};

export type ImportedTurnPreview = {
  exists: boolean;
  rawChanged: boolean;
  parsedChanged: boolean;
  warningsChanged: boolean;
};

export type ReportImportPreview = {
  parseResult: ReportParseResult;
  duplicatePreview: ImportedTurnPreview;
  turnNumber: number | null;
};

export {
  ADVISORY_CHECK_CODES,
  MOVEMENT_ORDER_COMMANDS,
  type AdvisoryCheckCode,
  type MovementOrderCommand
} from "./coreVocabulary.generated";

/** Which of the checks that read the report to run. */
export type OrderCheckOptions = {
  /**
   * Advisory codes not to produce. Omitted = the core's own default
   * (`OrderCheckOptions::default()` in Rust), which leaves out one code that would otherwise
   * speak about nearly every hex.
   *
   * Most hexes are deliberately unguarded, so warning about every one of them speaks about hex
   * after hex; dropping a guard you had is reported either way, because that is a change you may
   * not have meant.
   */
  disabledCodes?: readonly AdvisoryCheckCode[];
};

export type OrderDraftKey = {
  gameId: string;
  factionId: string;
  turnNumber: number;
};

export type OrderDraftRecord = {
  key: OrderDraftKey;
  orderText: string;
  updatedAt: string;
};

/** One player-written note on a hex. Keyed by id; `regionId` is `hexMapModel`'s `"z:x,y"`. */
export type HexNoteRecord = {
  id: string;
  gameId: string;
  regionId: string;
  text: string;
  onMap: boolean;
  turn: number;
  createdAt: string;
  updatedAt: string;
};

export type ImportedTurnRecord = {
  key: OrderDraftKey;
  rawReport: string;
  parseResult: ReportParseResult;
};

/** Enough to label an imported turn without loading its full report. */
export type ImportedTurnSummary = {
  key: OrderDraftKey;
  season: string | null;
  importedAt: string;
  updatedAt: string;
};
/**
 * The core, as one platform transport implements it — the desktop over Tauri IPC
 * (`createTauriAdapter`), the browser over WebAssembly and IndexedDB (`createWebCoreAdapter` in
 * `@atlantis/browser-core`). One method per Rust command, positional arguments in the command's
 * order and wire form (JSON strings stay strings here; `createCoreClient` is where an object is
 * accepted instead). Returns are the types the core serializes; nothing re-validates them.
 */
export interface CoreAdapter {
  getEngineInfo(): Promise<EngineInfo>;
  listGames(): Promise<GameManifest[]>;
  createGame(manifest: GameManifest): Promise<OpenedGame>;
  openGame(gameId: string, openedAt: string): Promise<OpenedGame>;
  deleteGame(gameId: string): Promise<void>;
  exportGame(gameId: string, exportedAt: string): Promise<string>;
  importGame(backupJson: string, openedAt: string): Promise<OpenedGame>;
  setGameRuleset(gameId: string, rulesetId: string): Promise<GameManifest>;
  setGameName(gameId: string, gameName: string): Promise<GameManifest>;
  setActiveFaction(gameId: string, factionId: string): Promise<GameManifest>;
  parseReport(rawReport: string): Promise<ReportParseResult>;
  parseReportFull(rawReport: string): Promise<ParsedReport>;
  parseReportClassified(rawReport: string, rulesetJson: string): Promise<ParsedReport>;
  previewReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string
  ): Promise<ReportImportPreview>;
  commitReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string,
    rulesetJson: string | null,
    allowOverwrite: boolean,
    importedAt: string
  ): Promise<ImportedTurnPreview>;
  validateOrders(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport: string | null,
    disabledCodes: readonly string[] | null
  ): Promise<OrderValidationResult>;
  orderCommands(): Promise<string[]>;
  /**
   * What may stand where the caret is, for the orders editor's completion popup: one order line
   * from its first character to the caret, answered with what the ruleset, the catalogue and the
   * hex allow there. Empty wherever the rules leave the position open, which is most of them.
   *
   * `rulesetJson` and `rawReport` are the served ruleset and the imported turn, when there are
   * any - only their presence widens the answer, since an item or a skill position is otherwise
   * closed. `unitId` is whose block is being typed, which is what makes `BUY`, `SELL` and
   * `PRODUCE` narrow to this unit's own hex.
   */
  orderArgumentCompletions(
    linePrefix: string,
    rulesetJson: string | null,
    rawReport: string | null,
    unitId: string | null
  ): Promise<OrderCompletion[]>;
  planRoute(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string
  ): Promise<RoutePlanResponse>;
  traceMoveOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    orders: string
  ): Promise<MoveOrderTraceResponse>;
  exportMap(rawReport: string, rememberedJson: string, requestJson: string): Promise<string>;
  knownMap(rawReport: string, rulesetJson: string | null, rememberedJson: string): Promise<KnownMap>;
  previewOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    ordersDocument: string
  ): Promise<OrdersPreviewResponse>;
  /** Every trade worth making in the map the faction has seen, best first. */
  tradeRoutes(rulesetJson: string, rawReport: string, rememberedJson: string): Promise<TradeRoute[]>;
  loadRegionSightings(
    databasePath: string,
    gameId: string,
    factionId: string
  ): Promise<RememberedRegion[]>;
  mergeReport(
    databasePath: string,
    gameId: string,
    viewerFactionId: string,
    viewerTurnNumber: number,
    rawReport: string,
    rulesetJson: string | null,
    mergedAt: string
  ): Promise<ReportMergeResult>;
  loadMergedReports(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<MergedReportRecord[]>;
  loadImportedTurn(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<ImportedTurnRecord | null>;
  loadLatestImportedTurn(databasePath: string, gameId: string): Promise<ImportedTurnRecord | null>;
  listImportedTurns(databasePath: string, gameId: string): Promise<ImportedTurnSummary[]>;
  loadOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<OrderDraftRecord | null>;
  saveOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number,
    orderText: string,
    updatedAt: string
  ): Promise<OrderDraftRecord>;
  listHexNotes(databasePath: string, gameId: string): Promise<HexNoteRecord[]>;
  saveHexNote(databasePath: string, note: HexNoteRecord): Promise<HexNoteRecord>;
  deleteHexNote(databasePath: string, gameId: string, noteId: string): Promise<void>;
}

/**
 * A game's imported turns in the order every list shows them: turn ascending, then faction id
 * ascending as text ("10" before "9" - the collation both stores always used). The one place this
 * order is written; both adapters return their rows in no particular order.
 */
export function sortImportedTurnSummaries(
  summaries: readonly ImportedTurnSummary[]
): ImportedTurnSummary[] {
  return [...summaries].sort((a, b) =>
    a.key.turnNumber !== b.key.turnNumber
      ? a.key.turnNumber - b.key.turnNumber
      : a.key.factionId < b.key.factionId
        ? -1
        : a.key.factionId > b.key.factionId
          ? 1
          : 0
  );
}

/** A game's hex notes, newest first (`createdAt` desc), `id` asc for stability. The one place this order is written. */
export function sortHexNotes(notes: readonly HexNoteRecord[]): HexNoteRecord[] {
  return [...notes].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt < b.createdAt ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * `CoreAdapter` with three ergonomic signatures: an object where the wire takes JSON text, and
 * options where the wire takes a list of disabled codes. Everything else is the adapter as it is —
 * `createCoreClient` is the whole of the difference.
 */
export type CoreClient = Omit<CoreAdapter, "validateOrders" | "exportMap" | "knownMap"> & {
  /**
   * Checks one orders document, and the turn it was written for.
   *
   * `rulesetJson` is the served ruleset when the shell has it. Without it the shape of every order
   * is still checked; only item names go unexamined, and an unrecognised one is a warning anyway.
   *
   * `rawReport` is the imported turn. With it the answer also covers what no amount of reading the
   * text could settle - whether the silver goes round the hex, whether anyone is left guarding it,
   * whether a teacher's students are studying. Without it the answer is the syntax check alone,
   * which is what the pane needs before any report has been imported.
   */
  validateOrders(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport?: string | null,
    options?: OrderCheckOptions
  ): Promise<OrderValidationResult>;
  /**
   * The known map inside one rectangle, written as report-shaped text for an ally to read.
   *
   * `rememberedJson` is the accumulated map exactly as the planner takes it; the current report
   * wins wherever the two describe the same hex. What comes back is the file's whole content -
   * saving it is the shell's business, because the core touches no filesystem.
   *
   * Rejects when the request or the remembered regions cannot be read. A rectangle covering
   * nothing known resolves with a header and no regions.
   */
  exportMap(rawReport: string, rememberedJson: string, request: MapExportRequest): Promise<string>;
  /**
   * Everything the faction knows about the map, resolved once by the core - the same rules the
   * planner and the risk heuristic already use, so a caller building a display over this cannot
   * disagree with either of them about who is in a hex.
   *
   * `rulesetJson` is optional: pass it when it is to hand so units carry exact men counts (a
   * classified parse), and `null` to fall back to the unclassified parse.
   *
   * Rejects only when the remembered regions cannot be read.
   */
  knownMap(
    rawReport: string,
    rulesetJson: string | null,
    remembered: RememberedRegion[]
  ): Promise<KnownMap>;
};

/**
 * The adapter's methods, spread through unchanged, plus the three ergonomic conversions
 * `CoreClient` adds over `CoreAdapter`. Nothing here re-validates what the adapter returns — the
 * Tauri wire is Rust's own serde output and the web adapter is our own code, so both are typed at
 * compile time instead of re-checked per call (ah-wxk.2).
 */
export function createCoreClient(adapter: CoreAdapter): CoreClient {
  return {
    ...adapter,
    validateOrders(rawOrders, rulesetJson, rawReport = null, options = {}) {
      // `null` is "use the core's own default" (`OrderCheckOptions::default()`), so the default
      // lives in Rust once instead of being copied here as a literal.
      return adapter.validateOrders(rawOrders, rulesetJson, rawReport, options.disabledCodes ?? null);
    },
    exportMap(rawReport, rememberedJson, request) {
      return adapter.exportMap(rawReport, rememberedJson, JSON.stringify(request));
    },
    knownMap(rawReport, rulesetJson, remembered) {
      return adapter.knownMap(rawReport, rulesetJson, JSON.stringify(remembered));
    },
    async listImportedTurns(databasePath, gameId) {
      return sortImportedTurnSummaries(await adapter.listImportedTurns(databasePath, gameId));
    },
    async listHexNotes(databasePath, gameId) {
      return sortHexNotes(await adapter.listHexNotes(databasePath, gameId));
    }
  };
}

export { createTauriAdapter, TAURI_COMMANDS, type TauriInvoke } from "./tauriCommands";
