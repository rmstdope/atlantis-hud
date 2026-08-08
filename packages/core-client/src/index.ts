export type GameInfo = {
  id: string;
  name: string;
  rulesetVersion: string;
  maxFactionCount: number;
};

export type ProjectMetadata = {
  projectId: string;
  projectName: string;
};

export type ReportSourceRef = {
  sourceId: string;
  label: string;
};

export type ProjectManifest = {
  manifestVersion: number;
  metadata: ProjectMetadata;
  reportSources: ReportSourceRef[];
};

export type OpenedProject = {
  projectFilePath: string;
  databasePath: string;
  schemaVersion: number;
  manifest: ProjectManifest;
};

export type WarningSeverity = "warning" | "error";

export type ParseWarning = {
  code: string;
  section: string;
  message: string;
  lineStart: number;
  lineEnd: number;
  severity: WarningSeverity;
};

export type TurnHeader = {
  turnNumber: number;
  season: string;
};

export type FactionInfo = {
  factionId: string;
  name: string;
};

export type RegionSummary = {
  regionId: string;
  name: string;
};

export type UnitSummary = {
  unitId: string;
  name: string;
  regionId: string;
};

export type InventoryItem = {
  unitId: string;
  item: string;
  quantity: number;
};

export type MessageSummary = {
  kind: string;
  source: string;
  text: string;
};

export type ReportParseResult = {
  turnHeader: TurnHeader | null;
  detectedFactions: FactionInfo[];
  regions: RegionSummary[];
  units: UnitSummary[];
  inventories: InventoryItem[];
  messageSummaries: MessageSummary[];
  warnings: ParseWarning[];
  meetsMinimumImportThreshold: boolean;
};


/**
 * Coordinates in the game's own space. Levels start at 1 for the surface.
 *
 * Only coordinates where `x + y` is even exist, which is why the map is drawn with flat-top hexes:
 * north and south are direct neighbours.
 */
export type Coordinate = { x: number; y: number; z: number };

export type ItemAmount = { amount: number; name: string; tag: string };
export type MarketItem = ItemAmount & { price: number };
export type SettlementInfo = { name: string; size: string };

export type RegionExit = {
  direction: string;
  terrain: string;
  coordinate: Coordinate;
  province: string;
  settlement: SettlementInfo | null;
};

export type StructureInfo = {
  structureId: string;
  name: string;
  kind: string;
  description: string | null;
  needs: number | null;
};

export type SkillInfo = { name: string; tag: string; level: number; points: number };

/** A unit as the report describes it. `own` comes from the report's marker, never from inference. */
export type ReportUnit = {
  unitId: string;
  name: string;
  regionId: string;
  factionId: string | null;
  factionName: string | null;
  own: boolean;
  onGuard: boolean;
  flags: string[];
  items: ItemAmount[];
  skills: SkillInfo[];
  /**
   * How many people the unit contains.
   *
   * Exact once the report has been classified against the scraped item catalogue; until then it is
   * the size of the leading item group, which is right for the common case and wrong for a unit
   * holding two races. `menEstimated` says which it is.
   */
  men: number;
  /** Whether `men` is a guess rather than a count. */
  menEstimated: boolean;
  /** The unit's people, by race, once classified. Empty while estimated. */
  menByRace: ItemAmount[];
  weight: number | null;
  capacity: string | null;
  structureId: string | null;
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
};

/** Where the unit stands when a month runs out. */
export type MonthLeg = { month: number; steps: number; endsAt: Coordinate };

export type RoutePlan = {
  from: Coordinate;
  to: Coordinate;
  mode: "fly" | "ride" | "walk";
  steps: RouteStep[];
  totalCost: number;
  months: MonthLeg[];
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
  | { kind: "unknownHex"; coordinate: Coordinate }
  | { kind: "oceanNeedsShip"; coordinate: Coordinate }
  | { kind: "flightWouldEndOverOcean"; coordinate: Coordinate };

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

export type ReportRegion = {
  regionId: string;
  coordinate: Coordinate;
  terrain: string;
  province: string;
  settlement: SettlementInfo | null;
  population: number | null;
  race: string | null;
  taxBase: number | null;
  wages: string | null;
  maxWages: number | null;
  entertainment: number | null;
  products: ItemAmount[];
  wanted: MarketItem[];
  forSale: MarketItem[];
  exits: RegionExit[];
  structures: StructureInfo[];
  units: ReportUnit[];
};

export type ReportHeaderInfo = {
  factionId: string | null;
  factionName: string | null;
  factionTypes: string[];
  month: string | null;
  year: number | null;
  turnNumber: number | null;
  engineVersion: string | null;
  ruleset: string | null;
  rulesetVersion: string | null;
  unclaimedSilver: number | null;
  errors: string[];
  events: string[];
};

/** One unit's slice of the orders document, comments included so the document round trips. */
export type UnitOrders = { unitId: string; lines: string[]; lineStart: number };

export type OrdersTemplate = {
  /** The document verbatim, from `#atlantis` through `#end`. Carries the faction password. */
  text: string;
  factionId: string | null;
  units: UnitOrders[];
};

/** The full model a report describes, as opposed to the flat summary in `ReportParseResult`. */
export type ParsedReport = {
  header: ReportHeaderInfo;
  regions: ReportRegion[];
  ordersTemplate: OrdersTemplate | null;
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

export type OrderDiagnosticSeverity = "warning" | "error";

export type OrderDiagnostic = {
  code: string;
  message: string;
  lineStart: number;
  lineEnd: number;
  severity: OrderDiagnosticSeverity;
};

export type OrderValidationResult = {
  diagnostics: OrderDiagnostic[];
};

export type OrderDraftKey = {
  projectId: string;
  factionId: string;
  turnNumber: number;
};

export type OrderDraftRecord = {
  key: OrderDraftKey;
  orderText: string;
  updatedAt: string;
};

export type ImportedTurnRecord = {
  key: OrderDraftKey;
  rawReport: string;
  parseResult: ReportParseResult;
};

type GameInfoWireShape = {
  id: string;
  name: string;
  rulesetVersion?: string;
  ruleset_version?: string;
  maxFactionCount?: number;
  max_faction_count?: number;
};

type ProjectMetadataWireShape = {
  projectId?: string;
  project_id?: string;
  projectName?: string;
  project_name?: string;
};

type ReportSourceRefWireShape = {
  sourceId?: string;
  source_id?: string;
  label?: string;
};

type ProjectManifestWireShape = {
  manifestVersion?: number;
  manifest_version?: number;
  metadata?: ProjectMetadataWireShape;
  reportSources?: ReportSourceRefWireShape[];
  report_sources?: ReportSourceRefWireShape[];
};

type OpenedProjectWireShape = {
  projectFilePath?: string;
  project_file_path?: string;
  databasePath?: string;
  database_path?: string;
  schemaVersion?: number;
  schema_version?: number;
  manifest?: ProjectManifestWireShape;
};

type TurnHeaderWireShape = {
  turnNumber?: number;
  turn_number?: number;
  season?: string;
};

type FactionInfoWireShape = {
  factionId?: string;
  faction_id?: string;
  name?: string;
};

type RegionSummaryWireShape = {
  regionId?: string;
  region_id?: string;
  name?: string;
};

type UnitSummaryWireShape = {
  unitId?: string;
  unit_id?: string;
  name?: string;
  regionId?: string;
  region_id?: string;
};

type InventoryItemWireShape = {
  unitId?: string;
  unit_id?: string;
  item?: string;
  quantity?: number;
};

type MessageSummaryWireShape = {
  kind?: string;
  source?: string;
  text?: string;
};

type ParseWarningWireShape = {
  code?: string;
  section?: string;
  message?: string;
  lineStart?: number;
  line_start?: number;
  lineEnd?: number;
  line_end?: number;
  severity?: string;
};

type ReportParseResultWireShape = {
  turnHeader?: TurnHeaderWireShape | null;
  turn_header?: TurnHeaderWireShape | null;
  detectedFactions?: FactionInfoWireShape[];
  detected_factions?: FactionInfoWireShape[];
  regions?: RegionSummaryWireShape[];
  units?: UnitSummaryWireShape[];
  inventories?: InventoryItemWireShape[];
  messageSummaries?: MessageSummaryWireShape[];
  message_summaries?: MessageSummaryWireShape[];
  warnings?: ParseWarningWireShape[];
  meetsMinimumImportThreshold?: boolean;
  meets_minimum_import_threshold?: boolean;
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
  parseResult?: ReportParseResultWireShape;
  parse_result?: ReportParseResultWireShape;
  duplicatePreview?: ImportedTurnPreviewWireShape;
  duplicate_preview?: ImportedTurnPreviewWireShape;
  turnNumber?: number | null;
  turn_number?: number | null;
};

type OrderDiagnosticWireShape = {
  code?: string;
  message?: string;
  lineStart?: number;
  line_start?: number;
  lineEnd?: number;
  line_end?: number;
  severity?: string;
};

type OrderValidationResultWireShape = {
  diagnostics?: OrderDiagnosticWireShape[];
};

type OrderDraftKeyWireShape = {
  projectId?: string;
  project_id?: string;
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

type ImportedTurnRecordWireShape = {
  key?: OrderDraftKeyWireShape;
  rawReport?: string;
  raw_report?: string;
  parseResult?: ReportParseResultWireShape;
  parse_result?: ReportParseResultWireShape;
};

export interface CoreAdapter {
  getGameInfo(): Promise<unknown> | unknown;
  createProject(projectFilePath: string, manifest: ProjectManifest): Promise<unknown> | unknown;
  openProject(projectFilePath: string): Promise<unknown> | unknown;
  parseReport(rawReport: string): Promise<unknown> | unknown;
  parseReportFull(rawReport: string): Promise<unknown> | unknown;
  previewReportImport(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string
  ): Promise<unknown> | unknown;
  commitReportImport(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string,
    allowOverwrite: boolean
  ): Promise<unknown> | unknown;
  validateOrders(rawOrders: string): Promise<unknown> | unknown;
  planRoute(
    rulesetJson: string,
    rawReport: string,
    unitId: string,
    destination: string
  ): Promise<unknown> | unknown;
  loadImportedTurn(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): Promise<unknown> | unknown;
  loadOrderDraft(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): Promise<unknown> | unknown;
  saveOrderDraft(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number,
    orderText: string,
    updatedAt: string
  ): Promise<unknown> | unknown;
}

export interface CoreClient {
  getGameInfo(): Promise<GameInfo>;
  createProject(projectFilePath: string, manifest: ProjectManifest): Promise<OpenedProject>;
  openProject(projectFilePath: string): Promise<OpenedProject>;
  parseReport(rawReport: string): Promise<ReportParseResult>;
  /** The full domain model. Returned as-is: it is descriptive data, not a contract to normalize. */
  parseReportFull(rawReport: string): Promise<ParsedReport>;
  previewReportImport(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string
  ): Promise<ReportImportPreview>;
  commitReportImport(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string,
    allowOverwrite: boolean
  ): Promise<ImportedTurnPreview>;
  validateOrders(rawOrders: string): Promise<OrderValidationResult>;
  /**
   * Plans a route for one unit, or explains why there is none.
   *
   * `destination` is a hex identifier the way the game writes one, `1:7,53`. Rejects only when the
   * ruleset cannot be used; a route that cannot be planned resolves with a stated reason.
   */
  planRoute(
    rulesetJson: string,
    rawReport: string,
    unitId: string,
    destination: string
  ): Promise<RoutePlanResponse>;
  loadImportedTurn(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): Promise<ImportedTurnRecord | null>;
  loadOrderDraft(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): Promise<OrderDraftRecord | null>;
  saveOrderDraft(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number,
    orderText: string,
    updatedAt: string
  ): Promise<OrderDraftRecord>;
}

export interface WasmBindings {
  get_game_info(): unknown;
  create_project_state(projectFilePath: string, manifest: ProjectManifest): unknown;
  open_project_state(projectFilePath: string): unknown;
  parse_report_state(rawReport: string): unknown;
  parse_report_full_state(rawReport: string): unknown;
  preview_report_import_state(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string
  ): unknown;
  commit_report_import_state(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string,
    allowOverwrite: boolean
  ): unknown;
  validate_orders_state(rawOrders: string): unknown;
  plan_route_state(
    rulesetJson: string,
    rawReport: string,
    unitId: string,
    destination: string
  ): unknown;
  load_imported_turn_state(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): unknown;
  load_order_draft_state(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): unknown;
  save_order_draft_state(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number,
    orderText: string,
    updatedAt: string
  ): unknown;
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function normalizeGameInfo(value: unknown): GameInfo {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid game info payload");
  }

  const payload = value as GameInfoWireShape;
  const rulesetVersion = payload.rulesetVersion ?? payload.ruleset_version;
  const maxFactionCount = payload.maxFactionCount ?? payload.max_faction_count;

  if (
    typeof payload.id !== "string" ||
    typeof payload.name !== "string" ||
    typeof rulesetVersion !== "string" ||
    typeof maxFactionCount !== "number"
  ) {
    throw new Error("incomplete game info payload");
  }

  return {
    id: payload.id,
    name: payload.name,
    rulesetVersion,
    maxFactionCount
  };
}

function normalizeProjectMetadata(value: unknown): ProjectMetadata {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid project metadata payload");
  }

  const payload = value as ProjectMetadataWireShape;
  const projectId = payload.projectId ?? payload.project_id;
  const projectName = payload.projectName ?? payload.project_name;

  if (typeof projectId !== "string" || typeof projectName !== "string") {
    throw new Error("incomplete project metadata payload");
  }

  return {
    projectId,
    projectName
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

function normalizeProjectManifest(value: unknown): ProjectManifest {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid project manifest payload");
  }

  const payload = value as ProjectManifestWireShape;
  const manifestVersion = payload.manifestVersion ?? payload.manifest_version;
  const reportSources = payload.reportSources ?? payload.report_sources;

  if (typeof manifestVersion !== "number" || !Array.isArray(reportSources) || payload.metadata === undefined) {
    throw new Error("incomplete project manifest payload");
  }

  return {
    manifestVersion,
    metadata: normalizeProjectMetadata(payload.metadata),
    reportSources: reportSources.map((source) => normalizeReportSourceRef(source))
  };
}

function normalizeOpenedProject(value: unknown): OpenedProject {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid opened project payload");
  }

  const payload = value as OpenedProjectWireShape;
  const projectFilePath = payload.projectFilePath ?? payload.project_file_path;
  const databasePath = payload.databasePath ?? payload.database_path;
  const schemaVersion = payload.schemaVersion ?? payload.schema_version;

  if (
    typeof projectFilePath !== "string" ||
    typeof databasePath !== "string" ||
    typeof schemaVersion !== "number" ||
    payload.manifest === undefined
  ) {
    throw new Error("incomplete opened project payload");
  }

  return {
    projectFilePath,
    databasePath,
    schemaVersion,
    manifest: normalizeProjectManifest(payload.manifest)
  };
}

function normalizeTurnHeader(value: unknown): TurnHeader {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid turn header payload");
  }
  const payload = value as TurnHeaderWireShape;
  const turnNumber = payload.turnNumber ?? payload.turn_number;
  if (typeof turnNumber !== "number" || typeof payload.season !== "string") {
    throw new Error("incomplete turn header payload");
  }
  return { turnNumber, season: payload.season };
}

function normalizeFaction(value: unknown): FactionInfo {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid faction payload");
  }
  const payload = value as FactionInfoWireShape;
  const factionId = payload.factionId ?? payload.faction_id;
  if (typeof factionId !== "string" || typeof payload.name !== "string") {
    throw new Error("incomplete faction payload");
  }
  return { factionId, name: payload.name };
}

function normalizeRegion(value: unknown): RegionSummary {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid region payload");
  }
  const payload = value as RegionSummaryWireShape;
  const regionId = payload.regionId ?? payload.region_id;
  if (typeof regionId !== "string" || typeof payload.name !== "string") {
    throw new Error("incomplete region payload");
  }
  return { regionId, name: payload.name };
}

function normalizeUnit(value: unknown): UnitSummary {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid unit payload");
  }
  const payload = value as UnitSummaryWireShape;
  const unitId = payload.unitId ?? payload.unit_id;
  const regionId = payload.regionId ?? payload.region_id;
  if (typeof unitId !== "string" || typeof payload.name !== "string" || typeof regionId !== "string") {
    throw new Error("incomplete unit payload");
  }
  return { unitId, name: payload.name, regionId };
}

function normalizeItem(value: unknown): InventoryItem {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid inventory item payload");
  }
  const payload = value as InventoryItemWireShape;
  const unitId = payload.unitId ?? payload.unit_id;
  if (typeof unitId !== "string" || typeof payload.item !== "string" || typeof payload.quantity !== "number") {
    throw new Error("incomplete inventory item payload");
  }
  return { unitId, item: payload.item, quantity: payload.quantity };
}

function normalizeMessage(value: unknown): MessageSummary {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid message summary payload");
  }
  const payload = value as MessageSummaryWireShape;
  if (typeof payload.kind !== "string" || typeof payload.source !== "string" || typeof payload.text !== "string") {
    throw new Error("incomplete message summary payload");
  }
  return { kind: payload.kind, source: payload.source, text: payload.text };
}

function normalizeWarning(value: unknown): ParseWarning {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid warning payload");
  }
  const payload = value as ParseWarningWireShape;
  const lineStart = payload.lineStart ?? payload.line_start;
  const lineEnd = payload.lineEnd ?? payload.line_end;
  if (
    typeof payload.code !== "string" ||
    typeof payload.section !== "string" ||
    typeof payload.message !== "string" ||
    typeof lineStart !== "number" ||
    typeof lineEnd !== "number" ||
    (payload.severity !== "warning" && payload.severity !== "error")
  ) {
    throw new Error("incomplete warning payload");
  }
  return {
    code: payload.code,
    section: payload.section,
    message: payload.message,
    lineStart,
    lineEnd,
    severity: payload.severity
  };
}

function normalizeParseResult(value: unknown): ReportParseResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid parse result payload");
  }
  const payload = value as ReportParseResultWireShape;
  const turnHeaderPayload = payload.turnHeader ?? payload.turn_header;
  const detectedFactions = payload.detectedFactions ?? payload.detected_factions;
  const messageSummaries = payload.messageSummaries ?? payload.message_summaries;
  const meetsMinimumImportThreshold =
    payload.meetsMinimumImportThreshold ?? payload.meets_minimum_import_threshold;
  if (
    !Array.isArray(detectedFactions) ||
    !Array.isArray(payload.regions) ||
    !Array.isArray(payload.units) ||
    !Array.isArray(payload.inventories) ||
    !Array.isArray(messageSummaries) ||
    !Array.isArray(payload.warnings) ||
    typeof meetsMinimumImportThreshold !== "boolean"
  ) {
    throw new Error("incomplete parse result payload");
  }

  return {
    turnHeader: turnHeaderPayload === null || turnHeaderPayload === undefined ? null : normalizeTurnHeader(turnHeaderPayload),
    detectedFactions: detectedFactions.map((faction) => normalizeFaction(faction)),
    regions: payload.regions.map((region) => normalizeRegion(region)),
    units: payload.units.map((unit) => normalizeUnit(unit)),
    inventories: payload.inventories.map((item) => normalizeItem(item)),
    messageSummaries: messageSummaries.map((summary) => normalizeMessage(summary)),
    warnings: payload.warnings.map((warning) => normalizeWarning(warning)),
    meetsMinimumImportThreshold
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

function normalizeOrderValidationResult(value: unknown): OrderValidationResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid order validation payload");
  }

  const payload = value as OrderValidationResultWireShape;
  const diagnostics = payload.diagnostics;

  if (!Array.isArray(diagnostics)) {
    throw new Error("incomplete order validation payload");
  }

  return {
    diagnostics: diagnostics.map((diagnostic) => {
      if (typeof diagnostic !== "object" || diagnostic === null) {
        throw new Error("invalid order validation payload");
      }

      const entry = diagnostic as OrderDiagnosticWireShape;
      const lineStart = entry.lineStart ?? entry.line_start;
      const lineEnd = entry.lineEnd ?? entry.line_end;

      if (
        typeof entry.code !== "string" ||
        typeof entry.message !== "string" ||
        typeof lineStart !== "number" ||
        typeof lineEnd !== "number" ||
        (entry.severity !== "warning" && entry.severity !== "error")
      ) {
        throw new Error("incomplete order validation payload");
      }

      return {
        code: entry.code,
        message: entry.message,
        lineStart,
        lineEnd,
        severity: entry.severity
      };
    })
  };
}

function normalizeOrderDraftKey(value: unknown): OrderDraftKey {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid order draft payload");
  }

  const payload = value as OrderDraftKeyWireShape;
  const projectId = payload.projectId ?? payload.project_id;
  const factionId = payload.factionId ?? payload.faction_id;
  const turnNumber = payload.turnNumber ?? payload.turn_number;

  if (typeof projectId !== "string" || typeof factionId !== "string" || typeof turnNumber !== "number") {
    throw new Error("incomplete order draft payload");
  }

  return {
    projectId,
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

function normalizeImportedTurnRecord(value: unknown): ImportedTurnRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid imported turn payload");
  }

  const payload = value as ImportedTurnRecordWireShape;
  const rawReport = payload.rawReport ?? payload.raw_report;
  const parseResult = payload.parseResult ?? payload.parse_result;

  if (payload.key === undefined || typeof rawReport !== "string" || parseResult === undefined) {
    throw new Error("incomplete imported turn payload");
  }

  return {
    key: normalizeOrderDraftKey(payload.key),
    rawReport,
    parseResult: normalizeParseResult(parseResult)
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
  if (parseResult === undefined || duplicatePreview === undefined) {
    throw new Error("incomplete report import preview payload");
  }
  if (turnNumber !== null && typeof turnNumber !== "number") {
    throw new Error("incomplete report import preview payload");
  }
  return {
    parseResult: normalizeParseResult(parseResult),
    duplicatePreview: normalizeImportedTurnPreview(duplicatePreview),
    turnNumber
  };
}

export function createCoreClient(adapter: CoreAdapter): CoreClient {
  return {
    async getGameInfo() {
      const value = await adapter.getGameInfo();
      return normalizeGameInfo(value);
    },
    async createProject(projectFilePath: string, manifest: ProjectManifest) {
      const value = await adapter.createProject(projectFilePath, manifest);
      return normalizeOpenedProject(value);
    },
    async openProject(projectFilePath: string) {
      const value = await adapter.openProject(projectFilePath);
      return normalizeOpenedProject(value);
    },
    async parseReport(rawReport: string) {
      const value = await adapter.parseReport(rawReport);
      return normalizeParseResult(value);
    },
    async parseReportFull(rawReport: string) {
      return (await adapter.parseReportFull(rawReport)) as ParsedReport;
    },
    async previewReportImport(databasePath: string, projectId: string, confirmedFactionId: string, rawReport: string) {
      const value = await adapter.previewReportImport(databasePath, projectId, confirmedFactionId, rawReport);
      return normalizeReportImportPreview(value);
    },
    async commitReportImport(
      databasePath: string,
      projectId: string,
      confirmedFactionId: string,
      rawReport: string,
      allowOverwrite: boolean
    ) {
      const value = await adapter.commitReportImport(
        databasePath,
        projectId,
        confirmedFactionId,
        rawReport,
        allowOverwrite
      );
      return normalizeImportedTurnPreview(value);
    },
    async validateOrders(rawOrders: string) {
      const value = await adapter.validateOrders(rawOrders);
      return normalizeOrderValidationResult(value);
    },
    async loadImportedTurn(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
      const value = await adapter.loadImportedTurn(databasePath, projectId, factionId, turnNumber);
      if (value === null) {
        return null;
      }
      return normalizeImportedTurnRecord(value);
    },
    async loadOrderDraft(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
      const value = await adapter.loadOrderDraft(databasePath, projectId, factionId, turnNumber);
      if (value === null) {
        return null;
      }

      return normalizeOrderDraftRecord(value);
    },
    async saveOrderDraft(
      databasePath: string,
      projectId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      const value = await adapter.saveOrderDraft(
        databasePath,
        projectId,
        factionId,
        turnNumber,
        orderText,
        updatedAt
      );
      return normalizeOrderDraftRecord(value);
    },
    async planRoute(
      rulesetJson: string,
      rawReport: string,
      unitId: string,
      destination: string
    ) {
      // Returned as-is: the core already serializes to exactly this shape, and normalizing would
      // only add a chance for the two to disagree.
      return (await adapter.planRoute(
        rulesetJson,
        rawReport,
        unitId,
        destination
      )) as RoutePlanResponse;
    }
  };
}

export function createWasmAdapter(bindings: WasmBindings): CoreAdapter {
  return {
    getGameInfo() {
      return bindings.get_game_info();
    },
    createProject(projectFilePath: string, manifest: ProjectManifest) {
      return bindings.create_project_state(projectFilePath, manifest);
    },
    openProject(projectFilePath: string) {
      return bindings.open_project_state(projectFilePath);
    },
    parseReport(rawReport: string) {
      return bindings.parse_report_state(rawReport);
    },
    parseReportFull(rawReport: string) {
      return bindings.parse_report_full_state(rawReport);
    },
    previewReportImport(databasePath: string, projectId: string, confirmedFactionId: string, rawReport: string) {
      return bindings.preview_report_import_state(databasePath, projectId, confirmedFactionId, rawReport);
    },
    commitReportImport(
      databasePath: string,
      projectId: string,
      confirmedFactionId: string,
      rawReport: string,
      allowOverwrite: boolean
    ) {
      return bindings.commit_report_import_state(
        databasePath,
        projectId,
        confirmedFactionId,
        rawReport,
        allowOverwrite
      );
    },
    validateOrders(rawOrders: string) {
      return bindings.validate_orders_state(rawOrders);
    },
    loadImportedTurn(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
      return bindings.load_imported_turn_state(databasePath, projectId, factionId, turnNumber);
    },
    loadOrderDraft(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
      return bindings.load_order_draft_state(databasePath, projectId, factionId, turnNumber);
    },
    saveOrderDraft(
      databasePath: string,
      projectId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      return bindings.save_order_draft_state(
        databasePath,
        projectId,
        factionId,
        turnNumber,
        orderText,
        updatedAt
      );
    },
    planRoute(rulesetJson: string, rawReport: string, unitId: string, destination: string) {
      return bindings.plan_route_state(rulesetJson, rawReport, unitId, destination);
    }
  };
}

export function createTauriAdapter(invoke: TauriInvoke): CoreAdapter {
  return {
    getGameInfo() {
      return invoke<GameInfoWireShape>("get_game_info");
    },
    createProject(projectFilePath: string, manifest: ProjectManifest) {
      return invoke<OpenedProjectWireShape>("create_project", {
        project_file_path: projectFilePath,
        manifest
      });
    },
    openProject(projectFilePath: string) {
      return invoke<OpenedProjectWireShape>("open_project", {
        project_file_path: projectFilePath
      });
    },
    parseReport(rawReport: string) {
      return invoke<ReportParseResultWireShape>("parse_report", {
        raw_report: rawReport
      });
    },
    parseReportFull(rawReport: string) {
      return invoke<ParsedReport>("parse_report_full", {
        raw_report: rawReport
      });
    },
    previewReportImport(databasePath: string, projectId: string, confirmedFactionId: string, rawReport: string) {
      return invoke<ReportImportPreviewWireShape>("preview_report_import", {
        database_path: databasePath,
        project_id: projectId,
        confirmed_faction_id: confirmedFactionId,
        raw_report: rawReport
      });
    },
    commitReportImport(
      databasePath: string,
      projectId: string,
      confirmedFactionId: string,
      rawReport: string,
      allowOverwrite: boolean
    ) {
      return invoke<ImportedTurnPreviewWireShape>("commit_report_import", {
        database_path: databasePath,
        project_id: projectId,
        confirmed_faction_id: confirmedFactionId,
        raw_report: rawReport,
        allow_overwrite: allowOverwrite
      });
    },
    validateOrders(rawOrders: string) {
      return invoke<OrderValidationResultWireShape>("validate_orders", {
        raw_orders: rawOrders
      });
    },
    loadImportedTurn(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
      return invoke<ImportedTurnRecordWireShape | null>("load_imported_turn", {
        database_path: databasePath,
        project_id: projectId,
        faction_id: factionId,
        turn_number: turnNumber
      });
    },
    loadOrderDraft(databasePath: string, projectId: string, factionId: string, turnNumber: number) {
      return invoke<OrderDraftRecordWireShape | null>("load_order_draft", {
        database_path: databasePath,
        project_id: projectId,
        faction_id: factionId,
        turn_number: turnNumber
      });
    },
    saveOrderDraft(
      databasePath: string,
      projectId: string,
      factionId: string,
      turnNumber: number,
      orderText: string,
      updatedAt: string
    ) {
      return invoke<OrderDraftRecordWireShape>("save_order_draft", {
        database_path: databasePath,
        project_id: projectId,
        faction_id: factionId,
        turn_number: turnNumber,
        order_text: orderText,
        updated_at: updatedAt
      });
    },
    planRoute(rulesetJson: string, rawReport: string, unitId: string, destination: string) {
      // Tauri is told the argument names are snake_case rather than translating here, which is what
      // commit 24779d7 settled after the mismatch cost a debugging session.
      return invoke<RoutePlanResponse>("plan_route", {
        ruleset_json: rulesetJson,
        raw_report: rawReport,
        unit_id: unitId,
        destination
      });
    }
  };
}
