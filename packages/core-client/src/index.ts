import type { AdvisoryCheckCode } from "./coreVocabulary.generated";

// The report model and the parse family are generated from the Rust core by ts-rs
// (crates/core, `cargo test`); see docs/implementation-plan.md §Generated bindings.
export type { EngineInfo } from "./generated/EngineInfo";
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

export { aBattle, aBattleUnit, aParsedReport, aReportHeaderInfo, aReportRegion, aReportUnit } from "./builders";

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
   * Advisory codes not to produce. Omitted = the default: everything except `hex-unguarded`.
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

type GameMetadataWireShape = {
  gameId?: string;
  game_id?: string;
  gameName?: string;
  game_name?: string;
  rulesetId?: string;
  ruleset_id?: string;
};

type ReportSourceRefWireShape = {
  sourceId?: string;
  source_id?: string;
  label?: string;
};

type GameManifestWireShape = {
  manifestVersion?: number;
  manifest_version?: number;
  metadata?: GameMetadataWireShape;
  reportSources?: ReportSourceRefWireShape[];
  report_sources?: ReportSourceRefWireShape[];
  createdAt?: string;
  created_at?: string;
  lastOpenedAt?: string;
  last_opened_at?: string;
};

type OpenedGameWireShape = {
  gameFilePath?: string;
  game_file_path?: string;
  databasePath?: string;
  database_path?: string;
  schemaVersion?: number;
  schema_version?: number;
  manifest?: GameManifestWireShape;
};

type ImportedTurnPreviewWireShape = {
  exists?: boolean;
  rawChanged?: boolean;
  raw_changed?: boolean;
  parsedChanged?: boolean;
  parsed_changed?: boolean;
  warningsChanged?: boolean;
  warnings_changed?: boolean;
};

type ReportImportPreviewWireShape = {
  parseResult?: unknown;
  parse_result?: unknown;
  duplicatePreview?: ImportedTurnPreviewWireShape;
  duplicate_preview?: ImportedTurnPreviewWireShape;
  turnNumber?: number | null;
  turn_number?: number | null;
};

type OrderDraftKeyWireShape = {
  gameId?: string;
  game_id?: string;
  factionId?: string;
  faction_id?: string;
  turnNumber?: number;
  turn_number?: number;
};

type OrderDraftRecordWireShape = {
  key?: OrderDraftKeyWireShape;
  orderText?: string;
  order_text?: string;
  updatedAt?: string;
  updated_at?: string;
};

type HexNoteRecordWireShape = {
  id?: string;
  gameId?: string;
  game_id?: string;
  regionId?: string;
  region_id?: string;
  text?: string;
  onMap?: boolean | number;
  on_map?: boolean | number;
  turn?: number;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
};

type ReportMergeResultWireShape = {
  turnNumber?: number;
  turn_number?: number;
  mergedFactionId?: string;
  merged_faction_id?: string;
  mergedFactionName?: string;
  merged_faction_name?: string;
  mergedRegionCount?: number;
  merged_region_count?: number;
  newRegionCount?: number;
  new_region_count?: number;
};

type ImportedTurnRecordWireShape = {
  key?: OrderDraftKeyWireShape;
  rawReport?: string;
  raw_report?: string;
  parseResult?: unknown;
  parse_result?: unknown;
};

type ImportedTurnSummaryWireShape = {
  key?: OrderDraftKeyWireShape;
  season?: string | null;
  importedAt?: string;
  imported_at?: string;
  updatedAt?: string;
  updated_at?: string;
};

export interface CoreAdapter {
  getEngineInfo(): Promise<unknown> | unknown;
  listGames(): Promise<unknown> | unknown;
  createGame(manifest: GameManifest): Promise<unknown> | unknown;
  openGame(gameId: string, openedAt: string): Promise<unknown> | unknown;
  deleteGame(gameId: string): Promise<unknown> | unknown;
  exportGame(gameId: string, exportedAt: string): Promise<unknown> | unknown;
  importGame(backupJson: string, openedAt: string): Promise<unknown> | unknown;
  setGameRuleset(gameId: string, rulesetId: string): Promise<unknown> | unknown;
  setGameName(gameId: string, gameName: string): Promise<unknown> | unknown;
  parseReport(rawReport: string): Promise<unknown> | unknown;
  parseReportFull(rawReport: string): Promise<unknown> | unknown;
  parseReportClassified(rawReport: string, rulesetJson: string): Promise<unknown> | unknown;
  previewReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string
  ): Promise<unknown> | unknown;
  commitReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string,
    rulesetJson: string | null,
    allowOverwrite: boolean,
    importedAt: string
  ): Promise<unknown> | unknown;
  validateOrders(
    rawOrders: string,
    rulesetJson: string | null,
    rawReport: string | null,
    disabledCodes: readonly string[]
  ): Promise<unknown> | unknown;
  orderCommands(): Promise<unknown> | unknown;
  planRoute(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string
  ): Promise<unknown> | unknown;
  traceMoveOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    orders: string
  ): Promise<unknown> | unknown;
  exportMap(
    rawReport: string,
    rememberedJson: string,
    requestJson: string
  ): Promise<unknown> | unknown;
  knownMap(
    rawReport: string,
    rulesetJson: string | null,
    rememberedJson: string
  ): Promise<unknown> | unknown;
  previewOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    ordersDocument: string
  ): Promise<unknown> | unknown;
  loadRegionSightings(
    databasePath: string,
    gameId: string,
    factionId: string
  ): Promise<unknown> | unknown;
  mergeReport(
    databasePath: string,
    gameId: string,
    viewerFactionId: string,
    viewerTurnNumber: number,
    rawReport: string,
    rulesetJson: string | null,
    mergedAt: string
  ): Promise<unknown> | unknown;
  loadMergedReports(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<unknown> | unknown;
  loadImportedTurn(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<unknown> | unknown;
  loadLatestImportedTurn(databasePath: string, gameId: string): Promise<unknown> | unknown;
  listImportedTurns(databasePath: string, gameId: string): Promise<unknown> | unknown;
  loadOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number
  ): Promise<unknown> | unknown;
  saveOrderDraft(
    databasePath: string,
    gameId: string,
    factionId: string,
    turnNumber: number,
    orderText: string,
    updatedAt: string
  ): Promise<unknown> | unknown;
  listHexNotes(databasePath: string, gameId: string): Promise<unknown> | unknown;
  saveHexNote(databasePath: string, note: HexNoteRecord): Promise<unknown> | unknown;
  deleteHexNote(databasePath: string, gameId: string, noteId: string): Promise<unknown> | unknown;
}

export interface CoreClient {
  getEngineInfo(): Promise<EngineInfo>;
  /**
   * Every game this installation holds, in whatever order storage produced them.
   *
   * Ordering is the caller's business: the picker sorts by when each was last opened, and baking
   * that into the contract would make the storage layer answer a question about presentation.
   */
  listGames(): Promise<GameManifest[]>;
  createGame(manifest: GameManifest): Promise<OpenedGame>;
  /** Opens a game and records that it was opened, which is what decides the next launch. */
  openGame(gameId: string, openedAt: string): Promise<OpenedGame>;
  /** Erases a game and everything it stored. There is no undo. */
  deleteGame(gameId: string): Promise<void>;
  /** Serializes one whole game, including turns, drafts and remembered map, to one JSON file. */
  exportGame(gameId: string, exportedAt: string): Promise<string>;
  /** Creates one game from an exported JSON file and opens it at `openedAt`. */
  importGame(backupJson: string, openedAt: string): Promise<OpenedGame>;
  /**
   * Changes which ruleset a game is played under, returning the updated manifest.
   *
   * The manifest comes back so the shell can refresh what it holds without a second round trip —
   * and re-fetch the ruleset itself, because everything parsed under the old one is now suspect.
   */
  setGameRuleset(gameId: string, rulesetId: string): Promise<GameManifest>;
  /**
   * Renames a game, returning the updated manifest. The manifest comes back so the shell can
   * refresh what it holds without a second round trip, the same as `setGameRuleset`.
   */
  setGameName(gameId: string, gameName: string): Promise<GameManifest>;
  parseReport(rawReport: string): Promise<ReportParseResult>;
  /** The full domain model. Returned as-is: it is descriptive data, not a contract to normalize. */
  parseReportFull(rawReport: string): Promise<ParsedReport>;
  /**
   * The same, with each unit's men counted against the item catalogue.
   *
   * A report cannot be split into men and equipment on its own, so without this every unit reads
   * as an estimate - including the great majority holding a single race, where the figure is exact.
   * An unusable ruleset leaves the report as parsed rather than refusing it.
   */
  parseReportClassified(rawReport: string, rulesetJson: string): Promise<ParsedReport>;
  previewReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string
  ): Promise<ReportImportPreview>;
  /**
   * Stores a turn in the open game, and remembers the regions it describes.
   *
   * `importedAt` is the caller's clock, in ISO-8601, the way `openGame` and `saveOrderDraft`
   * already take one. The persistence layer reads no clock of its own, so a turn and an order
   * draft can be compared to work out which the player touched last.
   *
   * `rulesetJson` classifies what gets remembered, exactly as `parseReportClassified` classifies
   * what gets shown. The stored sightings are the only account of a hex the map ever reads back,
   * so an estimate stored here is an estimate forever - a tilde on every remembered unit. `null`
   * when no ruleset could be fetched, which stores the estimates and says that is what they are.
   */
  commitReportImport(
    databasePath: string,
    gameId: string,
    confirmedFactionId: string,
    rawReport: string,
    rulesetJson: string | null,
    allowOverwrite: boolean,
    importedAt: string
  ): Promise<ImportedTurnPreview>;
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
   * Every order command the core knows.
   *
   * Asked for rather than kept, because a copy in the shell is a copy that drifts: the one this
   * replaced had four orders the ruleset has no such thing as and was missing END.
   */
  orderCommands(): Promise<string[]>;
  /**
   * Plans a route for one unit, or explains why there is none.
   *
   * `destination` is a hex identifier the way the game writes one, `1:7,53`. `rememberedJson` is
   * the accumulated map - regions the faction saw in earlier turns, as JSON - and it is what lets a
   * route be longer than one step: a single report describes its neighbours but not theirs. Pass an
   * empty array when there is nothing remembered.
   *
   * Rejects only when the ruleset cannot be used; a route that cannot be planned resolves with a
   * stated reason.
   */
  planRoute(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    destination: string
  ): Promise<RoutePlanResponse>;
  /**
   * Where the MOVE or ADVANCE order in a unit's written orders takes it.
   *
   * `orders` is the unit's own order block as the editor holds it; the last readable movement
   * line wins, matching how the game executes a re-issued order. Resolves with no path when
   * there is nothing to draw - no order, no such unit, or an unknown origin. Rejects only when
   * the ruleset or the remembered regions cannot be read.
   */
  traceMoveOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    unitId: string,
    orders: string
  ): Promise<MoveOrderTraceResponse>;
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
  exportMap(
    rawReport: string,
    rememberedJson: string,
    request: MapExportRequest
  ): Promise<string>;
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
  /**
   * What the whole orders document makes of the faction's units, region by region.
   *
   * `ordersDocument` is the full document rather than one unit's block, because GIVE crosses
   * units and MOVE crosses hexes: only the whole text says what a hex looks like next month.
   * Resolves with an empty answer when the orders change nothing the preview models. Rejects
   * only when the ruleset or the remembered regions cannot be read.
   */
  previewOrders(
    rulesetJson: string,
    rawReport: string,
    rememberedJson: string,
    ordersDocument: string
  ): Promise<OrdersPreviewResponse>;
  /**
   * Every region this faction has been seen in, across every turn imported into the game.
   *
   * Empty for a game with no committed imports, which is not an error: it is what a map looks
   * like before anything has been remembered.
   */
  loadRegionSightings(
    databasePath: string,
    gameId: string,
    factionId: string
  ): Promise<RememberedRegion[]>;
  /**
   * Folds an allied report for the same turn into the viewer's remembered map.
   *
   * The regions land under `viewerFactionId`, which is what makes them visible: the map is read
   * back one faction at a time, so a row written under the ally's id would be stored perfectly and
   * never looked at. No turn of the ally's is stored, so which turn the game reopens on does not
   * change - merging adds to the map without changing whose turn is on screen.
   *
   * Rejects when the report is not from `viewerTurnNumber`, which is the only turn it can be
   * merged into: two reports of one turn describe the same moment, so neither is staler.
   *
   * `rulesetJson` classifies the ally's units before they are stored, for the reason
   * `commitReportImport` gives: the merged units enter the map through these sightings and
   * nowhere else.
   */
  mergeReport(
    databasePath: string,
    gameId: string,
    viewerFactionId: string,
    viewerTurnNumber: number,
    rawReport: string,
    rulesetJson: string | null,
    mergedAt: string
  ): Promise<ReportMergeResult>;
  /**
   * Every allied report folded into one faction's map for one turn, oldest merge first.
   *
   * Empty is the ordinary case: most turns have nothing merged into them.
   */
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
  /**
   * The turn this game was last worked on, or `null` when it holds no imports.
   *
   * "Worked on" is the later of when a turn was imported and when its orders were last edited, so
   * a player who imported a second faction and then spent the evening on the first one's orders
   * comes back to the first. `null` is the ordinary state of a game just created.
   */
  loadLatestImportedTurn(databasePath: string, gameId: string): Promise<ImportedTurnRecord | null>;
  /**
   * Every turn imported for a game, across every faction, in turn order.
   *
   * A game with no imports returns an empty array, not an error — the ordinary state of a game
   * just created.
   */
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
  /** A game's hex notes, newest first. Empty for a game with none, not an error. */
  listHexNotes(databasePath: string, gameId: string): Promise<HexNoteRecord[]>;
  /** Inserts or updates one hex note; an edit is an upsert on `note.id`. */
  saveHexNote(databasePath: string, note: HexNoteRecord): Promise<HexNoteRecord>;
  /** Deletes one hex note. */
  deleteHexNote(databasePath: string, gameId: string, noteId: string): Promise<void>;
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function normalizeGameMetadata(value: unknown): GameMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid game metadata payload");
  }

  const payload = value as GameMetadataWireShape;
  const gameId = payload.gameId ?? payload.game_id;
  const gameName = payload.gameName ?? payload.game_name;
  const rulesetId = payload.rulesetId ?? payload.ruleset_id;

  if (typeof gameId !== "string" || typeof gameName !== "string" || typeof rulesetId !== "string") {
    throw new Error("incomplete game metadata payload");
  }

  return {
    gameId,
    gameName,
    rulesetId
  };
}

function normalizeReportSourceRef(value: unknown): ReportSourceRef {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid report source payload");
  }

  const payload = value as ReportSourceRefWireShape;
  const sourceId = payload.sourceId ?? payload.source_id;

  if (typeof sourceId !== "string" || typeof payload.label !== "string") {
    throw new Error("incomplete report source payload");
  }

  return {
    sourceId,
    label: payload.label
  };
}

function normalizeGameManifest(value: unknown): GameManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid game manifest payload");
  }

  const payload = value as GameManifestWireShape;
  const manifestVersion = payload.manifestVersion ?? payload.manifest_version;
  const reportSources = payload.reportSources ?? payload.report_sources;
  const createdAt = payload.createdAt ?? payload.created_at;
  const lastOpenedAt = payload.lastOpenedAt ?? payload.last_opened_at;

  if (
    typeof manifestVersion !== "number" ||
    !Array.isArray(reportSources) ||
    payload.metadata === undefined ||
    typeof createdAt !== "string" ||
    typeof lastOpenedAt !== "string"
  ) {
    throw new Error("incomplete game manifest payload");
  }

  return {
    manifestVersion,
    metadata: normalizeGameMetadata(payload.metadata),
    reportSources: reportSources.map((source) => normalizeReportSourceRef(source)),
    createdAt,
    lastOpenedAt
  };
}

function normalizeGameList(value: unknown): GameManifest[] {
  if (!Array.isArray(value)) {
    throw new Error("invalid game list payload");
  }

  return value.map((entry) => normalizeGameManifest(entry));
}

function normalizeOpenedGame(value: unknown): OpenedGame {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid opened game payload");
  }

  const payload = value as OpenedGameWireShape;
  const gameFilePath = payload.gameFilePath ?? payload.game_file_path;
  const databasePath = payload.databasePath ?? payload.database_path;
  const schemaVersion = payload.schemaVersion ?? payload.schema_version;

  if (
    typeof gameFilePath !== "string" ||
    typeof databasePath !== "string" ||
    typeof schemaVersion !== "number" ||
    payload.manifest === undefined
  ) {
    throw new Error("incomplete opened game payload");
  }

  return {
    gameFilePath,
    databasePath,
    schemaVersion,
    manifest: normalizeGameManifest(payload.manifest)
  };
}


function normalizeImportedTurnPreview(value: unknown): ImportedTurnPreview {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid import preview payload");
  }
  const payload = value as ImportedTurnPreviewWireShape;
  const rawChanged = payload.rawChanged ?? payload.raw_changed;
  const parsedChanged = payload.parsedChanged ?? payload.parsed_changed;
  const warningsChanged = payload.warningsChanged ?? payload.warnings_changed;
  if (
    typeof payload.exists !== "boolean" ||
    typeof rawChanged !== "boolean" ||
    typeof parsedChanged !== "boolean" ||
    typeof warningsChanged !== "boolean"
  ) {
    throw new Error("incomplete import preview payload");
  }
  return {
    exists: payload.exists,
    rawChanged,
    parsedChanged,
    warningsChanged
  };
}

/**
 * A merge outcome, or a refusal to believe one.
 *
 * Strict rather than tolerant, unlike `loadMergedReports` beside it. A count nobody can read means
 * the status line would say the merge did nothing while the database says otherwise, and the two
 * disagreeing quietly is worse than the merge visibly failing.
 */
function normalizeReportMergeResult(value: unknown): ReportMergeResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid report merge payload");
  }
  const payload = value as ReportMergeResultWireShape;
  const turnNumber = payload.turnNumber ?? payload.turn_number;
  const mergedFactionId = payload.mergedFactionId ?? payload.merged_faction_id;
  const mergedFactionName = payload.mergedFactionName ?? payload.merged_faction_name;
  const mergedRegionCount = payload.mergedRegionCount ?? payload.merged_region_count;
  const newRegionCount = payload.newRegionCount ?? payload.new_region_count;
  if (
    typeof turnNumber !== "number" ||
    typeof mergedFactionId !== "string" ||
    typeof mergedFactionName !== "string" ||
    typeof mergedRegionCount !== "number" ||
    typeof newRegionCount !== "number"
  ) {
    throw new Error("incomplete report merge payload");
  }
  return { turnNumber, mergedFactionId, mergedFactionName, mergedRegionCount, newRegionCount };
}

function normalizeOrderDraftKey(value: unknown): OrderDraftKey {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid order draft payload");
  }

  const payload = value as OrderDraftKeyWireShape;
  const gameId = payload.gameId ?? payload.game_id;
  const factionId = payload.factionId ?? payload.faction_id;
  const turnNumber = payload.turnNumber ?? payload.turn_number;

  if (typeof gameId !== "string" || typeof factionId !== "string" || typeof turnNumber !== "number") {
    throw new Error("incomplete order draft payload");
  }

  return {
    gameId,
    factionId,
    turnNumber
  };
}

function normalizeOrderDraftRecord(value: unknown): OrderDraftRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid order draft payload");
  }

  const payload = value as OrderDraftRecordWireShape;
  const orderText = payload.orderText ?? payload.order_text;
  const updatedAt = payload.updatedAt ?? payload.updated_at;

  if (payload.key === undefined || typeof orderText !== "string" || typeof updatedAt !== "string") {
    throw new Error("incomplete order draft payload");
  }

  return {
    key: normalizeOrderDraftKey(payload.key),
    orderText,
    updatedAt
  };
}

function normalizeHexNoteRecord(value: unknown): HexNoteRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid hex note payload");
  }

  const payload = value as HexNoteRecordWireShape;
  const gameId = payload.gameId ?? payload.game_id;
  const regionId = payload.regionId ?? payload.region_id;
  const onMapRaw = payload.onMap ?? payload.on_map;
  const createdAt = payload.createdAt ?? payload.created_at;
  const updatedAt = payload.updatedAt ?? payload.updated_at;

  if (
    typeof payload.id !== "string" ||
    typeof gameId !== "string" ||
    typeof regionId !== "string" ||
    typeof payload.text !== "string" ||
    (typeof onMapRaw !== "boolean" && onMapRaw !== 0 && onMapRaw !== 1) ||
    typeof payload.turn !== "number" ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    throw new Error("incomplete hex note payload");
  }

  return {
    id: payload.id,
    gameId,
    regionId,
    text: payload.text,
    onMap: typeof onMapRaw === "boolean" ? onMapRaw : onMapRaw !== 0,
    turn: payload.turn,
    createdAt,
    updatedAt
  };
}

function normalizeImportedTurnRecord(value: unknown): ImportedTurnRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid imported turn payload");
  }

  const payload = value as ImportedTurnRecordWireShape;
  const rawReport = payload.rawReport ?? payload.raw_report;
  const parseResult = payload.parseResult ?? payload.parse_result;

  if (
    payload.key === undefined ||
    typeof rawReport !== "string" ||
    typeof parseResult !== "object" ||
    parseResult === null
  ) {
    throw new Error("incomplete imported turn payload");
  }

  return {
    key: normalizeOrderDraftKey(payload.key),
    rawReport,
    // Returned as-is: it is the wire shape the core already serializes, not a contract to
    // normalize (ah-164.2).
    parseResult: parseResult as ReportParseResult
  };
}

function normalizeImportedTurnSummary(value: unknown): ImportedTurnSummary {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid imported turn summary payload");
  }

  const payload = value as ImportedTurnSummaryWireShape;
  const importedAt = payload.importedAt ?? payload.imported_at;
  const updatedAt = payload.updatedAt ?? payload.updated_at;
  const season = payload.season ?? null;

  if (payload.key === undefined || typeof importedAt !== "string" || typeof updatedAt !== "string") {
    throw new Error("incomplete imported turn summary payload");
  }
  if (season !== null && typeof season !== "string") {
    throw new Error("incomplete imported turn summary payload");
  }

  return {
    key: normalizeOrderDraftKey(payload.key),
    season,
    importedAt,
    updatedAt
  };
}

function normalizeReportImportPreview(value: unknown): ReportImportPreview {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid report import preview payload");
  }
  const payload = value as ReportImportPreviewWireShape;
  const parseResult = payload.parseResult ?? payload.parse_result;
  const duplicatePreview = payload.duplicatePreview ?? payload.duplicate_preview;
  const turnNumber = payload.turnNumber ?? payload.turn_number ?? null;
  if (
    typeof parseResult !== "object" ||
    parseResult === null ||
    duplicatePreview === undefined
  ) {
    throw new Error("incomplete report import preview payload");
  }
  if (turnNumber !== null && typeof turnNumber !== "number") {
    throw new Error("incomplete report import preview payload");
  }
  return {
    // Returned as-is, for the same reason normalizeImportedTurnRecord above does (ah-164.2).
    parseResult: parseResult as ReportParseResult,
    duplicatePreview: normalizeImportedTurnPreview(duplicatePreview),
    turnNumber
  };
}

export function createCoreClient(adapter: CoreAdapter): CoreClient {
  return {
    async getEngineInfo() {
      // Returned as-is: it is the wire shape the core already serializes, not a contract to
      // normalize (ah-164.2).
      return (await adapter.getEngineInfo()) as EngineInfo;
    },
    async listGames() {
      const value = await adapter.listGames();
      return normalizeGameList(value);
    },
    async createGame(manifest: GameManifest) {
      const value = await adapter.createGame(manifest);
      return normalizeOpenedGame(value);
    },
    async openGame(gameId: string, openedAt: string) {
      const value = await adapter.openGame(gameId, openedAt);
      return normalizeOpenedGame(value);
    },
    async deleteGame(gameId: string) {
      // Nothing to normalize: a deletion either happened or threw.
      await adapter.deleteGame(gameId);
    },
    async exportGame(gameId: string, exportedAt: string) {
      const value = await adapter.exportGame(gameId, exportedAt);
      if (typeof value !== "string") {
        throw new Error("invalid exported game payload");
      }
      return value;
    },
    async importGame(backupJson: string, openedAt: string) {
      const value = await adapter.importGame(backupJson, openedAt);
      return normalizeOpenedGame(value);
    },
    async setGameRuleset(gameId: string, rulesetId: string) {
      const value = await adapter.setGameRuleset(gameId, rulesetId);
      return normalizeGameManifest(value);
    },
    async setGameName(gameId: string, gameName: string) {
      const value = await adapter.setGameName(gameId, gameName);
      return normalizeGameManifest(value);
    },
    async parseReport(rawReport: string) {
      // Returned as-is: it is the wire shape the core already serializes, not a contract to
      // normalize (ah-164.2).
      return (await adapter.parseReport(rawReport)) as ReportParseResult;
    },
    async parseReportClassified(rawReport: string, rulesetJson: string) {
      return (await adapter.parseReportClassified(rawReport, rulesetJson)) as ParsedReport;
    },
    async parseReportFull(rawReport: string) {
      return (await adapter.parseReportFull(rawReport)) as ParsedReport;
    },
    async previewReportImport(databasePath: string, gameId: string, confirmedFactionId: string, rawReport: string) {
      const value = await adapter.previewReportImport(databasePath, gameId, confirmedFactionId, rawReport);
      return normalizeReportImportPreview(value);
    },
    async commitReportImport(
      databasePath: string,
      gameId: string,
      confirmedFactionId: string,
      rawReport: string,
      rulesetJson: string | null,
      allowOverwrite: boolean,
      importedAt: string
    ) {
      const value = await adapter.commitReportImport(
        databasePath,
        gameId,
        confirmedFactionId,
        rawReport,
        rulesetJson,
        allowOverwrite,
        importedAt
      );
      return normalizeImportedTurnPreview(value);
    },
    async validateOrders(
      rawOrders: string,
      rulesetJson: string | null,
      rawReport: string | null = null,
      options: OrderCheckOptions = {}
    ) {
      // Returned as-is: it is the wire shape the core already serializes, not a contract to
      // normalize (ah-164.2).
      return (await adapter.validateOrders(
        rawOrders,
        rulesetJson,
        rawReport,
        options.disabledCodes ?? ["hex-unguarded"]
      )) as OrderValidationResult;
    },
    async orderCommands() {
      const value = await adapter.orderCommands();
      if (!Array.isArray(value) || value.some((command) => typeof command !== "string")) {
        throw new Error("invalid order vocabulary payload");
      }
      return value as string[];
    },
    async loadImportedTurn(databasePath: string, gameId: string, factionId: string, turnNumber: number) {
      const value = await adapter.loadImportedTurn(databasePath, gameId, factionId, turnNumber);
      // Undefined as well as null, for the same reason loadLatestImportedTurn below treats them
      // alike: serde_wasm_bindgen can emit either for Rust's None, and a turn that genuinely is
      // not there must not read as a payload that failed to normalize (ah-6l2).
      if (value === null || value === undefined) {
        return null;
      }
      return normalizeImportedTurnRecord(value);
    },
    async loadLatestImportedTurn(databasePath: string, gameId: string) {
      const value = await adapter.loadLatestImportedTurn(databasePath, gameId);
      // Undefined as well as null: serde_wasm_bindgen can emit either for Rust's None, and a game
      // with nothing to reopen must not read as a payload that failed to normalize.
      if (value === null || value === undefined) {
        return null;
      }
      return normalizeImportedTurnRecord(value);
    },
    async listImportedTurns(databasePath: string, gameId: string) {
      const value = await adapter.listImportedTurns(databasePath, gameId);
      // A game with no imports is the ordinary state of a game just created, not a failure — so an
      // adapter answering with nothing (null or undefined, whichever the transport prefers) reads
      // as an empty list rather than as a payload that failed to normalize.
      if (value === undefined || value === null) {
        return [];
      }
      if (!Array.isArray(value)) {
        throw new Error("invalid imported turn summary list payload");
      }
      return value.map(normalizeImportedTurnSummary);
    },
    async loadOrderDraft(databasePath: string, gameId: string, factionId: string, turnNumber: number) {
      const value = await adapter.loadOrderDraft(databasePath, gameId, factionId, turnNumber);
      // Undefined as well as null, for the same reason loadImportedTurn does above (ah-6l2): a
      // sibling load with the identical "nothing stored yet" shape had the identical gap.
      if (value === null || value === undefined) {
        return null;
      }

      return normalizeOrderDraftRecord(value);
    },
    async saveOrderDraft(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      const value = await adapter.saveOrderDraft(
        databasePath,
        gameId,
        factionId,
        turnNumber,
        orderText,
        updatedAt
      );
      return normalizeOrderDraftRecord(value);
    },
    async listHexNotes(databasePath: string, gameId: string) {
      const value = await adapter.listHexNotes(databasePath, gameId);
      // A game with no notes is the ordinary state, not a failure — same "undefined and null both
      // mean empty" shape as listImportedTurns above.
      if (value === undefined || value === null) {
        return [];
      }
      if (!Array.isArray(value)) {
        throw new Error("invalid hex note list payload");
      }
      return value.map(normalizeHexNoteRecord);
    },
    async saveHexNote(databasePath: string, note: HexNoteRecord) {
      const value = await adapter.saveHexNote(databasePath, note);
      return normalizeHexNoteRecord(value);
    },
    async deleteHexNote(databasePath: string, gameId: string, noteId: string) {
      await adapter.deleteHexNote(databasePath, gameId, noteId);
    },
    async planRoute(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      destination: string
    ) {
      // Returned as-is: the core already serializes to exactly this shape, and normalizing would
      // only add a chance for the two to disagree.
      return (await adapter.planRoute(
        rulesetJson,
        rawReport,
        rememberedJson,
        unitId,
        destination
      )) as RoutePlanResponse;
    },
    async traceMoveOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      orders: string
    ) {
      // Returned as-is for the same reason planRoute is: the core already serializes this shape.
      return (await adapter.traceMoveOrders(
        rulesetJson,
        rawReport,
        rememberedJson,
        unitId,
        orders
      )) as MoveOrderTraceResponse;
    },
    async exportMap(rawReport: string, rememberedJson: string, request: MapExportRequest) {
      const text = await adapter.exportMap(rawReport, rememberedJson, JSON.stringify(request));
      // Checked rather than cast: everything else here comes back as a shape, and a shape that
      // arrives wrong is visibly wrong. A file is not - an unreadable answer saved as text would
      // be an empty document the player believes holds their map.
      if (typeof text !== "string") {
        throw new Error("map export did not come back as text");
      }
      return text;
    },
    async knownMap(rawReport: string, rulesetJson: string | null, remembered: RememberedRegion[]) {
      // Returned as-is for the same reason planRoute is: the core already serializes this shape.
      return (await adapter.knownMap(
        rawReport,
        rulesetJson,
        JSON.stringify(remembered)
      )) as KnownMap;
    },
    async previewOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      ordersDocument: string
    ) {
      // Returned as-is for the same reason planRoute is: the core already serializes this shape.
      return (await adapter.previewOrders(
        rulesetJson,
        rawReport,
        rememberedJson,
        ordersDocument
      )) as OrdersPreviewResponse;
    },
    async loadRegionSightings(databasePath: string, gameId: string, factionId: string) {
      const value = await adapter.loadRegionSightings(databasePath, gameId, factionId);
      return (Array.isArray(value) ? value : []) as RememberedRegion[];
    },
    async mergeReport(
      databasePath: string,
      gameId: string,
      viewerFactionId: string,
      viewerTurnNumber: number,
      rawReport: string,
      rulesetJson: string | null,
      mergedAt: string
    ) {
      return normalizeReportMergeResult(
        await adapter.mergeReport(
          databasePath,
          gameId,
          viewerFactionId,
          viewerTurnNumber,
          rawReport,
          rulesetJson,
          mergedAt
        )
      );
    },
    async loadMergedReports(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number
    ) {
      // Tolerated the way `loadRegionSightings` tolerates it: a turn with nothing merged into it
      // is the ordinary case, and a store that answers oddly should cost the chip, not the turn.
      const value = await adapter.loadMergedReports(databasePath, gameId, factionId, turnNumber);
      return (Array.isArray(value) ? value : []) as MergedReportRecord[];
    }
  };
}

export function createTauriAdapter(invoke: TauriInvoke): CoreAdapter {
  return {
    getEngineInfo() {
      return invoke<EngineInfo>("get_engine_info");
    },
    listGames() {
      return invoke<GameManifestWireShape[]>("list_games");
    },
    createGame(manifest: GameManifest) {
      return invoke<OpenedGameWireShape>("create_game", { manifest });
    },
    openGame(gameId: string, openedAt: string) {
      return invoke<OpenedGameWireShape>("open_game", {
        game_id: gameId,
        opened_at: openedAt
      });
    },
    deleteGame(gameId: string) {
      return invoke<void>("delete_game", { game_id: gameId });
    },
    exportGame(gameId: string, exportedAt: string) {
      return invoke<string>("export_game", { game_id: gameId, exported_at: exportedAt });
    },
    importGame(backupJson: string, openedAt: string) {
      return invoke<OpenedGameWireShape>("import_game", {
        backup_json: backupJson,
        opened_at: openedAt
      });
    },
    setGameRuleset(gameId: string, rulesetId: string) {
      return invoke<GameManifestWireShape>("set_game_ruleset", {
        game_id: gameId,
        ruleset_id: rulesetId
      });
    },
    setGameName(gameId: string, gameName: string) {
      return invoke<GameManifestWireShape>("set_game_name", {
        game_id: gameId,
        game_name: gameName
      });
    },
    parseReport(rawReport: string) {
      return invoke<ReportParseResult>("parse_report", {
        raw_report: rawReport
      });
    },
    parseReportFull(rawReport: string) {
      return invoke<ParsedReport>("parse_report_full", {
        raw_report: rawReport
      });
    },
    parseReportClassified(rawReport: string, rulesetJson: string) {
      return invoke<ParsedReport>("parse_report_classified", {
        raw_report: rawReport,
        ruleset_json: rulesetJson
      });
    },
    previewReportImport(databasePath: string, gameId: string, confirmedFactionId: string, rawReport: string) {
      return invoke<ReportImportPreviewWireShape>("preview_report_import", {
        database_path: databasePath,
        game_id: gameId,
        confirmed_faction_id: confirmedFactionId,
        raw_report: rawReport
      });
    },
    commitReportImport(
      databasePath: string,
      gameId: string,
      confirmedFactionId: string,
      rawReport: string,
      rulesetJson: string | null,
      allowOverwrite: boolean,
      importedAt: string
    ) {
      return invoke<ImportedTurnPreviewWireShape>("commit_report_import", {
        database_path: databasePath,
        game_id: gameId,
        confirmed_faction_id: confirmedFactionId,
        raw_report: rawReport,
        ruleset_json: rulesetJson,
        allow_overwrite: allowOverwrite,
        imported_at: importedAt
      });
    },
    validateOrders(
      rawOrders: string,
      rulesetJson: string | null,
      rawReport: string | null,
      disabledCodes: readonly string[]
    ) {
      return invoke<OrderValidationResult>("validate_orders", {
        raw_orders: rawOrders,
        ruleset_json: rulesetJson,
        raw_report: rawReport,
        disabled_codes: disabledCodes
      });
    },
    orderCommands() {
      return invoke<string[]>("order_commands");
    },
    loadImportedTurn(databasePath: string, gameId: string, factionId: string, turnNumber: number) {
      return invoke<ImportedTurnRecordWireShape | null>("load_imported_turn", {
        database_path: databasePath,
        game_id: gameId,
        faction_id: factionId,
        turn_number: turnNumber
      });
    },
    loadLatestImportedTurn(databasePath: string, gameId: string) {
      return invoke<ImportedTurnRecordWireShape | null>("load_latest_imported_turn", {
        database_path: databasePath,
        game_id: gameId
      });
    },
    listImportedTurns(databasePath: string, gameId: string) {
      return invoke<ImportedTurnSummaryWireShape[]>("list_imported_turns", {
        database_path: databasePath,
        game_id: gameId
      });
    },
    loadOrderDraft(databasePath: string, gameId: string, factionId: string, turnNumber: number) {
      return invoke<OrderDraftRecordWireShape | null>("load_order_draft", {
        database_path: databasePath,
        game_id: gameId,
        faction_id: factionId,
        turn_number: turnNumber
      });
    },
    saveOrderDraft(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      return invoke<OrderDraftRecordWireShape>("save_order_draft", {
        database_path: databasePath,
        game_id: gameId,
        faction_id: factionId,
        turn_number: turnNumber,
        order_text: orderText,
        updated_at: updatedAt
      });
    },
    listHexNotes(databasePath: string, gameId: string) {
      return invoke<HexNoteRecordWireShape[]>("list_hex_notes", {
        database_path: databasePath,
        game_id: gameId
      });
    },
    saveHexNote(databasePath: string, note: HexNoteRecord) {
      // The note goes through as one object, camelCase fields — the Tauri DTO's own
      // rename_all = "camelCase" reads them; only the invoke argument itself is snake_case.
      return invoke<HexNoteRecordWireShape>("save_hex_note", {
        database_path: databasePath,
        note
      });
    },
    deleteHexNote(databasePath: string, gameId: string, noteId: string) {
      return invoke<void>("delete_hex_note", {
        database_path: databasePath,
        game_id: gameId,
        note_id: noteId
      });
    },
    planRoute(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      destination: string
    ) {
      // Tauri is told the argument names are snake_case rather than translating here, which is what
      // commit 24779d7 settled after the mismatch cost a debugging session.
      return invoke<RoutePlanResponse>("plan_route", {
        ruleset_json: rulesetJson,
        raw_report: rawReport,
        remembered_json: rememberedJson,
        unit_id: unitId,
        destination
      });
    },
    traceMoveOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      unitId: string,
      orders: string
    ) {
      return invoke<MoveOrderTraceResponse>("trace_move_orders", {
        ruleset_json: rulesetJson,
        raw_report: rawReport,
        remembered_json: rememberedJson,
        unit_id: unitId,
        orders
      });
    },
    exportMap(rawReport: string, rememberedJson: string, requestJson: string) {
      return invoke<string>("export_map", {
        raw_report: rawReport,
        remembered_json: rememberedJson,
        request_json: requestJson
      });
    },
    knownMap(rawReport: string, rulesetJson: string | null, rememberedJson: string) {
      return invoke<KnownMap>("known_map", {
        raw_report: rawReport,
        ruleset_json: rulesetJson,
        remembered_json: rememberedJson
      });
    },
    previewOrders(
      rulesetJson: string,
      rawReport: string,
      rememberedJson: string,
      ordersDocument: string
    ) {
      return invoke<OrdersPreviewResponse>("preview_orders", {
        ruleset_json: rulesetJson,
        raw_report: rawReport,
        remembered_json: rememberedJson,
        orders_document: ordersDocument
      });
    },
    loadRegionSightings(databasePath: string, gameId: string, factionId: string) {
      return invoke<RememberedRegion[]>("load_region_sightings", {
        database_path: databasePath,
        game_id: gameId,
        faction_id: factionId
      });
    },
    mergeReport(
      databasePath: string,
      gameId: string,
      viewerFactionId: string,
      viewerTurnNumber: number,
      rawReport: string,
      rulesetJson: string | null,
      mergedAt: string
    ) {
      return invoke<ReportMergeResult>("merge_report", {
        database_path: databasePath,
        game_id: gameId,
        viewer_faction_id: viewerFactionId,
        viewer_turn_number: viewerTurnNumber,
        raw_report: rawReport,
        ruleset_json: rulesetJson,
        merged_at: mergedAt
      });
    },
    loadMergedReports(
      databasePath: string,
      gameId: string,
      factionId: string,
      turnNumber: number
    ) {
      return invoke<MergedReportRecord[]>("load_merged_reports", {
        database_path: databasePath,
        game_id: gameId,
        faction_id: factionId,
        turn_number: turnNumber
      });
    }
  };
}
