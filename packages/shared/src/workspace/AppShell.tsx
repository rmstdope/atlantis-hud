import type {
  CoreClient,
  GameManifest,
  ImportedTurnSummary,
  MapExportContent,
  MergedReportRecord,
  OpenedGame,
  ParsedReport,
  MoveOrderTraceResponse,
  OrdersPreviewResponse,
  RegionPreview,
  RememberedRegion,
  RoutePlanResponse
} from "@atlantis/core-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildHexMapModel,
  parseRegionId,
  unitsForHex,
  type HexMapModel
} from "../hexMapModel";
import { deliverTextFile, type TextFileSaver } from "../downloadFile";
import { exportFileName, exportRequestOf } from "../mapExport";
import { readUnitOrders, stripMovementOrderLines, writeUnitOrders } from "../ordersDocument";
import { describeOrdersImport, isOrdersFile, ordersFileFaction } from "../ordersImport";
import { ordersExportText } from "./ordersExport";
import {
  commitTurn,
  mergeTurn,
  readMemory,
  rememberTurn,
  restoreLatestTurn,
  toStoredRegions,
  type MemoryOutcome
} from "../gameMemory";
import { decideReportLoad, isOlderTurn } from "../reportLoadDecision";
import {
  chooseViewerFaction,
  planReportBatch,
  type BatchCandidate,
  type BatchSkip
} from "../reportBatch";
import type { ImportSummary } from "../importSummary";
import { describeMerge } from "../foreignReport";
import {
  AUTOSAVE_CEILING_MS,
  AUTOSAVE_IDLE_MS,
  createDraftWriter,
  documentFor,
  draftKeyFor,
  savedStateFor,
  type DraftWriter,
  type SaveState
} from "../orderDraft";
import {
  findingsByHex,
  findingsForHex,
  shouldTriggerAutosave,
  type ValidatedOrders
} from "../orderEditor";
import {
  gameAfterDelete,
  newGameId,
  newGameManifest,
  openNewestGame,
  rulesetUrlFor
} from "../gameSession";
import { rulesetById } from "../rulesets";
import { DEFAULT_LEVEL, useWorkspaceStore } from "../workspaceStore";
import { useSettingsStore } from "../settingsStore";
import { AppHeader, type ImportStatus } from "./AppHeader";
import { TurnPicker } from "./TurnPicker";
import { comparisonChipLabel, toggleComparison, type ComparisonTurn } from "../turnCompare";
import { GameGate } from "./GameGate";
import { SettingsDialog } from "./SettingsDialog";
import type { AppUpdateControl } from "./appUpdate";
import { UNSUPPORTED_UPDATES } from "./appUpdate";
import { ForeignReportPrompt } from "./ForeignReportPrompt";
import { ImportSummaryDialog } from "./ImportSummaryDialog";
import { OrdersImportPrompt } from "./OrdersImportPrompt";
import { OrdersImportSummaryDialog, type OrdersImportSummary } from "./OrdersImportSummaryDialog";
import { ViewerFactionPrompt, type ViewerFactionOption } from "./ViewerFactionPrompt";
import { GamePicker } from "./GamePicker";
import { FactionPanel } from "./FactionPanel";
import { MergedFactionsPanel } from "./MergedFactionsPanel";
import { LayerChips } from "./LayerChips";
import { MapCanvas } from "./MapCanvas";
import { MapExportDialog } from "./MapExportDialog";
import { BattlesDialog } from "./BattlesDialog";
import { ChangesDialog } from "./ChangesDialog";
import {
  changesTabs,
  orderRows,
  ordersEmptyText,
  regionRows,
  regionsEmptyText,
  unitRows,
  unitsEmptyText,
  type ChangesTabKey
} from "./changesView";
import { diffOrders, diffTurns } from "../turnDiff";
import { type MapRect } from "./mapMarquee";
import { loadSavedView, saveFocusForGame } from "./mapViewportStorage";
import { getMapTheme } from "./mapThemes";
import { OrdersPanel } from "./OrdersPanel";
import type { OrdersEditorHandle } from "./OrdersEditor";
import { CommandPalette } from "./CommandPalette";
import { ShortcutHelp } from "./ShortcutHelp";
import { buildPaletteEntries } from "../commandPalette";
import { diagnosticTargets, stepDiagnostic } from "../diagnosticNav";
import { hasOpenDismissLayers } from "../dismissStack";
import { firesInContext, isMacPlatform, matchShortcut, SHORTCUTS } from "../shortcuts";
import { nextOwnUnit } from "../unitCycle";
import { ordersSlotClass, ordersSlotStyle, unitSlotClass } from "./panelLayout";
import { PanelSplitter } from "./PanelSplitter";
import { PlannerPanel } from "./PlannerPanel";
import { chooseRouteOverlay } from "./routeOverlay";
import { RegionPanel } from "./RegionPanel";
import { ProblemsPanel } from "./ProblemsPanel";
import { TurnMessagesPanel, type TurnMessagesTab } from "./TurnMessagesPanel";
import { UnitPanel } from "./UnitPanel";
import { UnitTableDock } from "./UnitTableDock";

/**
 * Turns whatever was thrown into something a user can act on.
 *
 * Tauri rejects with a plain string rather than an Error, so checking `instanceof Error` alone
 * discards the only useful detail and leaves "unknown error" on screen.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  try {
    return JSON.stringify(error) ?? "unknown error";
  } catch {
    return "unknown error";
  }
}

/**
 * Re-exported rather than defined here since issue #53 moved the rule into `reportLoadDecision`.
 *
 * It is now one branch of a larger decision, and it sits beside the others in a plain module that
 * can be tested without rendering anything.
 */
export { isOlderTurn };

/**
 * Builds and delivers an orders export - the part of `exportOrders`/`exportOrdersLong` that has no
 * dependency on React state or hooks, pulled out so it can be tested without rendering the shell.
 *
 * Plain and long share the same file name deliberately (see `ordersExportText`'s callers) - it is
 * the same orders file either way. A failed write is logged and swallowed rather than thrown, since
 * these callbacks are fire-and-forget from the export menu and an unhandled rejection is worse than
 * a console line; a cancelled save (`deliver` resolving `null`) takes the same quiet path.
 *
 * `deliver` exists for the tests and defaults to the real `deliverTextFile`; callers never pass it.
 */
export async function deliverOrdersExport(
  saveTextFile: TextFileSaver | undefined,
  turnNumber: number | null | undefined,
  ordersDocument: string,
  ordersTemplateText: string | null,
  withDescriptions: boolean,
  deliver: typeof deliverTextFile = deliverTextFile
): Promise<void> {
  const fileName = `orders-turn-${turnNumber ?? "unknown"}.txt`;
  const text = ordersExportText(ordersDocument, ordersTemplateText, withDescriptions);
  try {
    await deliver(saveTextFile, fileName, text, "text/plain");
  } catch (error: unknown) {
    console.error("Failed to export orders:", error);
  }
}

/**
 * Builds and delivers a game backup - the part of `exportGameBackup` that has no dependency on
 * React state or hooks, pulled out the same way `deliverOrdersExport` was so it can be tested
 * without rendering the shell.
 *
 * Resolves with the path written, `""` for a browser download, or `null` when the player cancelled
 * the save - the caller uses that to decide whether the picker may claim the export happened.
 *
 * `deliver` exists for the tests and defaults to the real `deliverTextFile`; callers never pass it.
 */
export async function deliverGameBackupExport(
  saveTextFile: TextFileSaver | undefined,
  gameId: string,
  backup: string,
  deliver: typeof deliverTextFile = deliverTextFile
): Promise<string | null> {
  const fileName = `${gameId}.atlantis-hud-game.json`;
  return deliver(saveTextFile, fileName, backup, "application/json");
}

/**
 * Loads and parses the turn a comparison click asked for - the part of
 * `handleSelectComparisonTurn` that has no dependency on React state or hooks, pulled out the same
 * way `deliverOrdersExport` was so it can be tested without rendering the shell.
 *
 * Unlike the inline code it replaces, this never resolves to "nothing happened": a missing turn or
 * a failed load/parse rejects with an `Error`, so the caller has something to put on the status
 * line instead of a click that silently does nothing (ah-6l2).
 */
export async function loadComparisonTurn(
  client: { loadImportedTurn: CoreClient["loadImportedTurn"] },
  databasePath: string,
  gameId: string,
  factionId: string,
  turnNumber: number,
  parse: (rawReport: string) => Promise<ParsedReport>
): Promise<ComparisonTurn> {
  const record = await client.loadImportedTurn(databasePath, gameId, factionId, turnNumber);
  if (record === null) {
    throw new Error(`turn ${turnNumber} is no longer available to compare against`);
  }
  const parsed = await parse(record.rawReport);
  return { key: { factionId: record.key.factionId, turnNumber }, parsed };
}

/**
 * A parsed report from another faction, held while the player decides what to do with it.
 *
 * The viewer's identity is a snapshot taken when the question was raised, not read again when it is
 * answered. The report on screen can change underneath an open prompt - a game finishing its
 * restore is enough - and merging into whoever happens to be showing by then is not what was asked.
 */
type PendingReportLoad = {
  report: ParsedReport;
  text: string;
  fileName: string;
  /** False when the turns do not match, in which case only switching is on offer. */
  canMerge: boolean;
  viewer: { factionId: string; factionLabel: string; turnNumber: number | null };
  incoming: { factionLabel: string; turnNumber: number | null };
};

/**
 * An orders file, recognised and waiting for the player to confirm the overwrite before it is
 * applied.
 *
 * The counts are worked out once, when the file is recognised, from the document on screen at that
 * moment - the same snapshot discipline `PendingReportLoad` keeps, and for the same reason: the
 * document being overwritten must be the one the numbers describe, not whatever it happens to be
 * when Replace is finally pressed.
 */
type PendingOrdersImport = {
  text: string;
  fileName: string;
  /** How the current faction names itself, as `Borg TNG (95)` - the file's faction too, by then. */
  factionLabel: string;
  /**
   * The game, faction and turn the counts above describe - taken when the file was recognised, and
   * checked again before Replace applies anything. The player can switch game, faction or turn
   * while this prompt sits on screen (a report that loads without asking, a different game picked),
   * and Replace must then refuse rather than write a stale file into whatever is open by then.
   */
  gameId: string;
  factionId: string;
  turnNumber: number;
  unitCount: number;
  emptiedCount: number;
};

/**
 * Every file of a batch, read and parsed, before a word of it has been written.
 *
 * The three lists are parallel and indexed by the chosen file, which is what lets a step name the
 * file it means by position rather than by name - two folders dragged at once can hand over two
 * files called `turn.rep`. `read` holds `null` exactly where `unreadable` holds a reason.
 */
type PreparedBatch = {
  read: ({ text: string; report: ParsedReport } | null)[];
  candidates: BatchCandidate[];
  unreadable: BatchSkip[];
};

/**
 * How a report names its own faction, as `Borg TNG (95)`, or `null` when it names none.
 *
 * The header has always shown this; the foreign-report prompt needs it too, and for two reports at
 * once. A report with an id and no name still has something to say, so it says that rather than
 * nothing - but a header with no report loaded shows no faction at all, which is why this stays
 * nullable rather than inventing a placeholder here.
 */
function factionLabelOf(report: ParsedReport | null): string | null {
  const name = report?.header.factionName;
  const id = report?.header.factionId;
  if (name && id) {
    return `${name} (${id})`;
  }
  return name ?? id ?? null;
}

const EMPTY: HexMapModel = {
  hexes: [],
  levels: [1],
  currentTurn: null,
  initialSelectedRegionId: null
};

/**
 * Where the open game's ruleset has got to.
 *
 * "Still arriving" and "not coming" have to be told apart. A report parsed while the fetch is in
 * flight is parsed unclassified, which turns every unit's man-count into an estimate; a single
 * nullable string cannot say which of the two is happening, so the restore below cannot know
 * whether waiting would help.
 */
type RulesetState =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "unavailable" };

/**
 * The whole workspace, shared by both platforms.
 *
 * Both shells render this and differ only in which `CoreClient` they hand it, which is what makes
 * the desktop and the web builds identical rather than merely similar. Previously each shell had
 * its own copy of the layout.
 */
/**
 * Somewhere to hang a handler that runs before the application closes.
 *
 * The web needs nothing here: `pagehide` covers a tab closing, a reload and a navigation away, and
 * this shell registers it itself. A native window close is not a page event and Tauri does not
 * promise to fire one, so the desktop shell passes an implementation that intercepts the close,
 * lets the handler finish and then destroys the window.
 *
 * A prop rather than a Tauri import in here, because `packages/shared` is what makes the two builds
 * identical: reaching for `@tauri-apps/api` from shared code would put half a desktop in the web
 * bundle. Returns whatever undoes the registration.
 */
export type RegisterBeforeQuit = (handler: () => Promise<void>) => () => void;

export function AppShell({
  client,
  platformLabel,
  registerBeforeQuit,
  saveTextFile,
  appUpdate = UNSUPPORTED_UPDATES
}: {
  client: CoreClient;
  platformLabel: string;
  registerBeforeQuit?: RegisterBeforeQuit;
  /**
   * How this shell puts a file where the player asks, when it can.
   *
   * Injected for the same reason `registerBeforeQuit` is. Absent in a browser, which can only hand
   * the file to the download machinery and cannot learn where it went; present on the desktop,
   * which asks and can then say.
   */
  saveTextFile?: TextFileSaver;
  /**
   * How this shell answers "is there a newer version". Injected for the same reason
   * `registerBeforeQuit` is: the web answer is a service worker and the desktop answer is Tauri,
   * and neither belongs in a package whose job is to be identical on both.
   *
   * Defaulted rather than optional at the use site, because there is a real third case - the
   * desktop bundle opened in a plain browser - and it needs a control that says so.
   */
  appUpdate?: AppUpdateControl;
}) {
  const [parsed, setParsed] = useState<ParsedReport | null>(null);
  // The report currently on screen, readable at async resolve time. The restore effect below
  // needs to know whether anything is showing *when its promise lands*, which state in its
  // closure cannot say.
  const displayedTurn = useRef<ParsedReport | null>(null);
  useEffect(() => {
    displayedTurn.current = parsed;
  }, [parsed]);
  // Everywhere the faction has ever been, not just this turn. Without it the map stops at the
  // fringe of the current report and no route can be longer than one step.
  const [remembered, setRemembered] = useState<RememberedRegion[]>([]);
  const [ordersDocument, setOrdersDocument] = useState("");
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [validated, setValidated] = useState<ValidatedOrders>({ text: "", diagnostics: [] });
  const [save, setSave] = useState<SaveState>({ kind: "clean" });
  // The planner takes the report as text, which keeps the call stateless: there is no session to
  // invalidate when a new turn arrives. The text is also the key the core remembers its last parse
  // under, so the report shown here is the one the planner searches rather than a fresh parse.
  const [rawReport, setRawReport] = useState("");
  const [ruleset, setRuleset] = useState<RulesetState>({ status: "loading" });
  // The core's order vocabulary, fetched once for the editor's completion popup. Empty until it
  // arrives - or if it never does, which just leaves the popup with nothing to say.
  const [orderCommands, setOrderCommands] = useState<readonly string[]>([]);
  // The same ruleset as the storage layer wants it: its text once it arrived, `null` while it has
  // not. What gets stored is classified with exactly what the screen was classified with.
  const rulesetText = ruleset.status === "ready" ? ruleset.text : null;
  const [route, setRoute] = useState<RoutePlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  // The selected unit's written MOVE order, traced so the map can draw it. Follows the editor
  // rather than the saved draft, exactly as validation does.
  const [orderTrace, setOrderTrace] = useState<MoveOrderTraceResponse | null>(null);
  // What the whole orders document makes of the faction's units, so the units table and the unit
  // panel show the coming month. Follows the editor exactly as validation does.
  const [ordersPreview, setOrdersPreview] = useState<OrdersPreviewResponse | null>(null);
  // Which game is open, and every game there is. Both live here because both change together:
  // creating, switching and deleting all move the open game and the list in one step.
  const [game, setGame] = useState<OpenedGame | null>(null);
  const [games, setGames] = useState<GameManifest[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * The shortcuts overlay, open from the first frame when the player has not turned that off.
   *
   * Read straight into the initial state rather than opened by an effect: the store rehydrates
   * from storage before React mounts, so the answer is already known, and an effect would show the
   * overlay a frame late - a flash of the workspace, then a modal over it. That rests on the
   * rehydration being synchronous, which it is for `localStorage`; a storage backend that answered
   * asynchronously would leave this reading the default and greeting everybody every time.
   *
   * Read once, at mount. Unticking the box inside the overlay must not close the overlay under the
   * hand that ticked it, and turning the preference back on in settings must not reopen it.
   */
  const [helpOpen, setHelpOpen] = useState(
    () => useSettingsStore.getState().showShortcutsAtStartup
  );
  // The map export: whether its dialog is open, the rectangle a Shift+drag left behind, and how
  // the last attempt went. The rectangle outlives the dialog so re-opening it offers the same
  // area, and a drag while the dialog is closed is remembered rather than wasted.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRect, setExportRect] = useState<MapRect | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // The F8 walk's stop and its pending cross-unit landing. A ref for the stop: pressing F8
  // twice must not wait a render between the steps.
  const lastDiagnostic = useRef<number | null>(null);
  const [pendingProblem, setPendingProblem] = useState<
    ReturnType<typeof diagnosticTargets>[number] | null
  >(null);
  const ordersEditor = useRef<OrdersEditorHandle | null>(null);
  const ordersSlotRef = useRef<HTMLDivElement | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  // Which of the turn's two lists is being read, and whether either is. Local rather than in the
  // store, exactly as the game picker is: it is a panel that is open for a moment, not a preference.
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [battlesOpen, setBattlesOpen] = useState(false);
  const [selectedBattleIndex, setSelectedBattleIndex] = useState(0);
  const [messagesTab, setMessagesTab] = useState<TurnMessagesTab>("errors");
  // A report from another faction, parsed and waiting for the player to say what to do with it,
  // and whose reports have already been folded into the turn on screen.
  const [pendingLoad, setPendingLoad] = useState<PendingReportLoad | null>(null);
  // An orders file, recognised and waiting for the player to confirm the overwrite it names -
  // `pendingLoad`'s sibling for the other kind of file the Import target takes. The two clear each
  // other on arrival: only one question is ever on screen at a time.
  const [pendingOrdersImport, setPendingOrdersImport] = useState<PendingOrdersImport | null>(null);
  const [ordersImportSummary, setOrdersImportSummary] = useState<OrdersImportSummary | null>(null);
  const [mergedReports, setMergedReports] = useState<MergedReportRecord[]>([]);
  const [mergedOpen, setMergedOpen] = useState(false);
  const [factionOpen, setFactionOpen] = useState(false);
  // A second, read-only turn held beside the working one (ah-jg6.3), and the picker that chooses
  // it. Plain `useState`, as the panel-open flags above are: a comparison is transient, never
  // persisted, and is cleared the moment the working turn changes underneath it.
  const [comparison, setComparison] = useState<ComparisonTurn | null>(null);
  // The diff dialog (ah-jg6.4), and the tab it is showing. Transient like `battlesOpen`; closed
  // by the effect below whenever the comparison it reads dies out from under it.
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesTab, setChangesTab] = useState<ChangesTabKey>("units");
  // The compared side's orders text, loaded lazily on the dialog's first open for a given
  // compared turn - never eagerly, and never by pointing `parsed`/`ordersDocument` at it (see
  // `comparison`'s own doc comment). `turnNumber` guards against serving a stale load after the
  // comparison has moved on to a different turn.
  const [comparedOrders, setComparedOrders] = useState<{ turnNumber: number; text: string | null } | null>(
    null
  );
  const [turnPickerOpen, setTurnPickerOpen] = useState(false);
  const [turnSummaries, setTurnSummaries] = useState<ImportedTurnSummary[]>([]);
  // What a batch of reports did, waiting to be read, and how far it has got while it is running.
  // Both null for a single report: that one still answers for itself through the status line.
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  // A batch read and parsed, waiting for the player to say which of its factions is theirs. The
  // only question a batch ever asks, and only when the headers tie.
  const [pendingBatch, setPendingBatch] = useState<{
    batch: PreparedBatch;
    options: ViewerFactionOption[];
  } | null>(null);

  const selectedRegionId = useWorkspaceStore((state) => state.selectedRegionId);
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectionEpoch = useWorkspaceStore((state) => state.selectionEpoch);
  const selectRegion = useWorkspaceStore((state) => state.selectRegion);
  const restoreSelection = useWorkspaceStore((state) => state.restoreSelection);
  const selectUnit = useWorkspaceStore((state) => state.selectUnit);
  const level = useWorkspaceStore((state) => state.level);
  const setLevel = useWorkspaceStore((state) => state.setLevel);
  const layers = useWorkspaceStore((state) => state.layers);
  const badges = useWorkspaceStore((state) => state.badges);
  const showTextures = useSettingsStore((state) => state.biomeTextures);
  const mapThemeId = useSettingsStore((state) => state.mapTheme);
  const warnOnUnguardedHex = useSettingsStore((state) => state.warnOnUnguardedHex);
  const movementPlanner = useSettingsStore((state) => state.movementPlanner);
  const snippets = useSettingsStore((state) => state.snippets);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  // Which panels are folded is a layout question as well as a panel one: a folded panel hands the
  // space it gives up to the panel beside it, and only the shell knows what is beside what.
  const collapsed = useWorkspaceStore((state) => state.collapsed);
  // The player's own split between the unit panel and the orders editor, dragged at the grip
  // between them; null means the default pin from `panelLayout.ts` still applies.
  const ordersHeightRem = useWorkspaceStore((state) => state.ordersHeightRem);
  const setOrdersHeight = useWorkspaceStore((state) => state.setOrdersHeight);
  const planner = useWorkspaceStore((state) => state.planner);
  const armPlanner = useWorkspaceStore((state) => state.armPlanner);
  const planTo = useWorkspaceStore((state) => state.planTo);
  const clearPlan = useWorkspaceStore((state) => state.clearPlan);
  const openGameInStore = useWorkspaceStore((state) => state.openGame);

  // Turning the flag off mid-gesture must take the gesture with it. An armed planner would go on
  // swallowing map clicks with no pane to say why, and a planned route would go on shadowing the
  // selected unit's own orders on the movement layer.
  useEffect(() => {
    if (!movementPlanner) {
      clearPlan();
      setRoute(null);
    }
  }, [movementPlanner, clearPlan]);

  const closeGameInStore = useWorkspaceStore((state) => state.closeGame);
  const updateGameRulesetInStore = useWorkspaceStore((state) => state.updateGameRuleset);

  /**
   * What is owed to storage, and one write at a time.
   *
   * The bookkeeping lives in `orderDraft.ts` rather than in refs here, because every interesting
   * case in it is a race - a keystroke landing mid-write, a forced flush arriving while a timed one
   * is in flight - and none of them can be tested while they live inside a component. Held in a ref
   * so it survives re-renders and so the quit handler, which runs outside React's world, can reach
   * the same one.
   */
  const writerRef = useRef<DraftWriter | null>(null);
  writerRef.current ??= createDraftWriter(client, setSave);
  const writer = writerRef.current;

  /** Stable across renders, so the effects below do not re-register on every keystroke. */
  const flush = useCallback(() => writer.flush(), [writer]);

  // The map wants remembered regions flattened; the planner wants them as they are. Both come from
  // the same list, so neither can drift out of step with the other.
  const storedRegions = useMemo(() => toStoredRegions(remembered), [remembered]);
  // Serialized once per imported turn rather than once per route. The memory changes when a turn
  // is imported and at no other time, so doing this inside the planning effect meant serializing
  // every hex the faction has ever seen on the click that picks a destination.
  const rememberedJson = useMemo(() => JSON.stringify(remembered), [remembered]);
  const model = useMemo(
    () => (parsed ? buildHexMapModel(parsed, storedRegions) : EMPTY),
    [parsed, storedRegions]
  );

  const openGameId = game?.manifest.metadata.gameId ?? null;

  // Remembers which level and which hex the player is on, so reopening the game comes back to them.
  // The map saves its own pan and zoom as it moves; these two live in the workspace store, which
  // knows nothing about which game is open, so the shell is where they are written from.
  useEffect(() => {
    if (openGameId === null) {
      return;
    }
    saveFocusForGame(openGameId, level, selectedRegionId);
  }, [openGameId, level, selectedRegionId]);

  // A level restored from storage that this game no longer draws. It can happen: the underworld
  // may only have been visible in an older report. Nothing on that level would be drawn and there
  // is nothing there to frame, so the whole saved view is abandoned and the defaults take over.
  useEffect(() => {
    if (openGameId === null || model === EMPTY || model.levels.includes(level)) {
      return;
    }
    setLevel(model.levels[0] ?? DEFAULT_LEVEL);
  }, [openGameId, model, level, setLevel]);

  /**
   * Selects a hex together with the first unit standing in it.
   *
   * `unitsForHex` sorts the player's own units first, so this lands on one of theirs whenever the
   * hex holds any, and only falls to a foreign unit when it does not.
   */
  const selectHex = useCallback(
    (regionId: string | null) => {
      // While the planner is armed the map means "where to", not "show me". One click, then it
      // goes back to selecting - a mode you can forget you are in makes every later click a
      // surprise.
      if (planner.armed && regionId) {
        planTo(regionId);
        return;
      }
      const target = model.hexes.find((candidate) => candidate.regionId === regionId) ?? null;
      selectRegion(regionId, unitsForHex(target)[0]?.unitId ?? null);
    },
    [model, selectRegion, planner.armed, planTo]
  );

  const hex = useMemo(
    () => model.hexes.find((candidate) => candidate.regionId === selectedRegionId) ?? null,
    [model, selectedRegionId]
  );

  /**
   * The selected hex when no report has ever described it.
   *
   * Clicking empty ground is how a player finds out which hex an ally's coordinates name, and there
   * is no node in the model for such a hex - the map holds only what is known. The id is all there
   * is, and the coordinate it names is all the panel can say.
   */
  const unknownHex = useMemo(
    () => (hex || selectedRegionId === null ? null : parseRegionId(selectedRegionId)),
    [hex, selectedRegionId]
  );

  /**
   * How a hex reads in the problems list. The id `1:7,53` is what the core files a finding under
   * and is no way to tell a player which hex they should go and look at.
   */
  const hexLabel = useCallback(
    (regionId: string) => {
      const found = model.hexes.find((candidate) => candidate.regionId === regionId);
      if (found) {
        return `${found.terrain} (${found.coordinate.x},${found.coordinate.y})`;
      }
      const unexplored = parseRegionId(regionId);
      return unexplored ? `unexplored (${unexplored.x},${unexplored.y})` : regionId;
    },
    [model]
  );

  const unit = useMemo(
    () => hex?.region?.units.find((candidate) => candidate.unitId === selectedUnitId) ?? null,
    [hex, selectedUnitId]
  );

  /** What the engine said about this turn. Null when there is no turn on screen to say it about. */
  const messages = useMemo(
    () => (parsed ? { errors: parsed.header.errors, events: parsed.header.events } : null),
    [parsed]
  );

  /**
   * Where every unit the turn describes is standing.
   *
   * Foreign units included: a message can name one - being robbed by someone is an event about
   * their unit as much as yours - and a hex is a hex whoever is standing in it.
   */
  const unitRegions = useMemo(() => {
    const found = new Map<string, string>();
    for (const region of parsed?.regions ?? []) {
      for (const candidate of region.units) {
        found.set(candidate.unitId, region.regionId);
      }
    }
    return found;
  }, [parsed]);

  /** Which of the units a message names can actually be gone to. */
  const knownUnitIds = useMemo(() => new Set(unitRegions.keys()), [unitRegions]);

  /**
   * Goes to the unit a turn message names.
   *
   * A unit can be standing on a level the player is not looking at, and the map draws one level at
   * a time. `setLevel` clears the selection when the level changes, so it has to come first -
   * selecting and then switching would leave nothing selected at all.
   */
  const goToUnit = useCallback(
    (unitId: string) => {
      const regionId = unitRegions.get(unitId);
      if (!regionId) {
        return;
      }
      // Region ids are `z:x,y`, so the level the unit is on is written on the front of its hex.
      const target = Number(regionId.split(":")[0]);
      if (Number.isFinite(target) && target !== level) {
        setLevel(target);
      }
      selectRegion(regionId, unitId);
      // And the unit itself, because `selectRegion` leaves the selection alone when the hex is
      // already the one on screen - which is exactly the case where a second message names a
      // different unit standing beside the first.
      selectUnit(unitId);
      setMessagesOpen(false);
    },
    [unitRegions, level, setLevel, selectRegion, selectUnit]
  );

  // The player's own units in the report's own order - region by region, units within each -
  // which is the order the Alt+Arrow walk reads them in.
  const orderedOwnUnitIds = useMemo(
    () =>
      parsed
        ? parsed.regions.flatMap((region) =>
            region.units.filter((candidate) => candidate.own).map((candidate) => candidate.unitId)
          )
        : [],
    [parsed]
  );

  // Every problem the F8 walk can visit, in document order, against the text validation saw.
  const problemTargets = useMemo(
    () => diagnosticTargets(validated.text, validated.diagnostics),
    [validated]
  );

  // A fresh validation is a fresh walk: the old stop indexes a list that no longer exists.
  useEffect(() => {
    lastDiagnostic.current = null;
  }, [validated]);

  // A cross-unit F8 landing: the unit's editor mounts on the commit after goToUnit, so the
  // selection is placed from here rather than from the keydown that asked for it.
  useEffect(() => {
    if (!pendingProblem) {
      return;
    }
    if (unit?.unitId === pendingProblem.unitId) {
      ordersEditor.current?.selectProblem(pendingProblem.problem);
    }
    // Consumed either way once the selection has moved at all: a landing left waiting would
    // fire on some much later, unrelated visit to that unit.
    setPendingProblem(null);
  }, [pendingProblem, unit]);

  const walkProblems = useCallback(
    (direction: 1 | -1) => {
      const step = stepDiagnostic(problemTargets.length, lastDiagnostic.current, direction);
      if (step === null) {
        return;
      }
      lastDiagnostic.current = step;
      const target = problemTargets[step];
      if (unit?.unitId === target.unitId) {
        ordersEditor.current?.selectProblem(target.problem);
      } else {
        goToUnit(target.unitId);
        setPendingProblem(target);
      }
    },
    [problemTargets, unit, goToUnit]
  );

  const dispatchShortcut = useCallback(
    (id: ReturnType<typeof matchShortcut> & string) => {
      switch (id) {
        case "palette":
          setPaletteOpen((open) => !open);
          break;
        case "help":
          setHelpOpen((open) => !open);
          break;
        case "nextUnit":
        case "prevUnit": {
          const target = nextOwnUnit(
            orderedOwnUnitIds,
            unit?.unitId ?? null,
            id === "nextUnit" ? 1 : -1
          );
          if (target) {
            goToUnit(target);
          }
          break;
        }
        case "nextDiagnostic":
          walkProblems(1);
          break;
        case "prevDiagnostic":
          walkProblems(-1);
          break;
      }
    },
    [orderedOwnUnitIds, unit, goToUnit, walkProblems]
  );

  // The global keyboard layer: one bubble-phase listener, so every widget's own keys - the
  // map's arrows, the table's, Escape everywhere - get first refusal, and only the chords the
  // table claims are taken. preventDefault matters beyond politeness: Mod+K is the browser's
  // own search-the-address-bar chord.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const id = matchShortcut(event, isMacPlatform());
      if (!id) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const isOrdersEditor = target !== null && target.closest('[data-testid="orders-input"]') !== null;
      const isTextInput =
        isOrdersEditor ||
        (target !== null &&
          target.closest('input, textarea, select, [contenteditable="true"]') !== null);
      if (!firesInContext(id, { isTextInput, isOrdersEditor })) {
        return;
      }
      // Behind an open dialog or palette the cycling chords stand down: walking the selection
      // under an overlay mutates what nobody can see. The palette and help stay reachable -
      // pressing their chord again is how they toggle closed.
      if (id !== "palette" && id !== "help" && hasOpenDismissLayers()) {
        return;
      }
      event.preventDefault();
      dispatchShortcut(id);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dispatchShortcut]);

  // Everything the palette can reach, rebuilt only when the world it names changes.
  const paletteEntries = useMemo(() => {
    const mac = isMacPlatform();
    const helpSpec = SHORTCUTS.find((entry) => entry.id === "help");
    return buildPaletteEntries({
      ownUnits: orderedOwnUnitIds.map((unitId) => {
        const owner = parsed?.regions
          .flatMap((region) => region.units)
          .find((candidate) => candidate.unitId === unitId);
        return { unitId, name: owner?.name ?? unitId, run: () => goToUnit(unitId) };
      }),
      regions: model.hexes.map((candidate) => ({
        regionId: candidate.regionId,
        label: candidate.label,
        run: () => selectHex(candidate.regionId)
      })),
      actions: [
        { id: "settings", label: "Open settings", run: () => setSettingsOpen(true) },
        // Only where the picker can actually open: on the gate screen it renders nowhere, and
        // a pickerOpen left true would pop the picker uninvited into the next game.
        ...(game
          ? [{ id: "switch-game", label: "Switch game", run: () => setPickerOpen(true) }]
          : []),
        {
          id: "toggle-theme",
          label: "Toggle theme",
          run: () => setTheme(theme === "dark" ? "light" : "dark")
        },
        {
          id: "shortcuts",
          // Named for what it shows and for what a player would type looking for it: somebody
          // hunting "shortcuts" finds the same entry as somebody hunting "getting around".
          label: "Getting around (shortcuts and mouse)",
          binding: helpSpec ? (mac ? helpSpec.mac : helpSpec.other) : undefined,
          run: () => setHelpOpen(true)
        },
        // Only with a report on screen: an export needs a turn to name itself after and a map to
        // describe, and neither exists before one is imported.
        ...(parsed ? [{ id: "export-map", label: "Export map", run: () => openExport() }] : []),
        // Only when the turn actually had a battle - as with the chip, a command that opens onto
        // nothing is worse than no command at all.
        ...(parsed && parsed.battles.length > 0
          ? [
              {
                id: "open-battles",
                label: "Open battles",
                run: () => {
                  setSelectedBattleIndex(0);
                  setBattlesOpen(true);
                }
              }
            ]
          : [])
      ],
      orderCommands,
      insertOrder: (command) => ordersEditor.current?.insertOrder(command)
    });
  }, [orderedOwnUnitIds, parsed, model, goToUnit, selectHex, setTheme, theme, orderCommands, game]);

  /**
   * Puts a parsed report on screen and files it in the game.
   *
   * Split out of `loadReport` so that the direct path and the path through the foreign-report
   * prompt run identical code: a report the player reached by pressing "Switch faction" must land
   * exactly as one they simply opened. Deliberately does not depend on `parsed` - only the decision
   * above needs to know what is already loaded, and putting it here would rebuild this callback
   * every time a report is opened.
   */
  const applyReport = useCallback(
    async (
      report: ParsedReport,
      text: string,
      fileName: string,
      /**
       * The map to show it against, when the caller has already committed this turn.
       *
       * A batch has: it walked the turn in and merged that turn's allies on top of it. Committing
       * again here would undo the second half of that - a commit rewrites the turn's sightings from
       * the own report alone, so every hex the ally contributed to and the viewer also stood in
       * would lose the ally's account of it, while the "+1 merged" chip went on claiming it.
       */
      committed?: MemoryOutcome
    ) => {
      try {
        setParsed(report);
        setRawReport(text);
        clearPlan();
        setRoute(null);
        // A new working turn redefines the pair: a comparison held against the turn just replaced
        // would go on claiming a relationship to a turn no longer on screen.
        setComparison(null);
        setTurnPickerOpen(false);

        // Commit the turn to the faction's game and read back every region it has ever seen.
        // A report on its own describes the hexes the faction stood in and names their neighbours,
        // but not *their* neighbours - so without this the map stops at the fringe and no route can
        // be longer than one step. Failing to remember is a warning, never a reason to withhold a
        // report that parsed perfectly well.
        // The same ruleset the report was parsed with, so what is remembered is classified the
        // way what is shown is. `null` when none could be fetched, which stores the estimates.
        const memory =
          committed ??
          (game
            ? await rememberTurn(client, game, report, text, rulesetText, new Date().toISOString())
            : { remembered: [], merged: [], warning: null });
        setRemembered(memory.remembered);
        // Reset from the turn just loaded, never merely added to: a merge belongs to the turn it
        // was made in, so turn 71's allies must not still be claimed on turn 72's map.
        setMergedReports(memory.merged);

        // Saved orders beat the report's own template, including on opening the same file again.
        // There is no undo anywhere in this application, and a stray file-open must not silently
        // erase an evening's work; a new turn's report brings a clean template with it.
        const template = report.ordersTemplate?.text ?? "";
        const chosen = game
          ? await documentFor(client, game, draftKeyFor(report), template)
          : { text: template, restored: false, savedAt: null, warning: null };
        setOrdersDocument(chosen.text);
        setSave(savedStateFor(chosen.savedAt));

        // The banner keeps the import summary. That saved orders were preferred to the template is
        // the orders panel's business, and it says so there with the time they were written -
        // putting it here would cost the region and unit counts the player just asked for.
        const unitCount = report.regions.reduce((total, region) => total + region.units.length, 0);
        setStatus({
          regionCount: report.regions.length,
          unitCount,
          message: memory.warning ?? chosen.warning,
          failed: false,
          // A message here is always a warning: the routine case is the counts, message-less.
          warning: (memory.warning ?? chosen.warning) !== null
        });

        // Opening on a hex the player has units in beats opening on whatever came first, and the
        // unit inside it is chosen for the same reason.
        //
        // Only when nothing is selected, which is the same guard the restore path makes: a turn
        // landing in a game already being worked in is not a reason to move the player. It used to
        // move them, and the map travelled to the new selection, so an import threw away whatever
        // corner of the map they had just navigated to.
        if (useWorkspaceStore.getState().selectedRegionId === null) {
          const opening = buildHexMapModel(report);
          const openingHex = opening.hexes.find(
            (candidate) => candidate.regionId === opening.initialSelectedRegionId
          );
          selectRegion(
            opening.initialSelectedRegionId,
            unitsForHex(openingHex ?? null)[0]?.unitId ?? null
          );
        }
      } catch (error) {
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: `could not read ${fileName}: ${describeError(error)}`,
          failed: true,
          warning: false
        });
      }
    },
    [client, selectRegion, clearPlan, game, rulesetText]
  );

  /**
   * Commits an older report to the game's stored turn history, and leaves the screen untouched.
   *
   * gh-208: an older report - own or foreign - must never become the working turn, but it is still
   * committed so the turn-comparison feature (ah-jg6.3/4) can read it later. Deliberately calls none
   * of `setParsed`, `setRawReport`, `setOrdersDocument`, `setSave`, `clearPlan`, `setRoute`,
   * `setComparison`, `setTurnPickerOpen` or `selectRegion` - see `applyReport`'s own note on the same
   * point, and the same reasoning applies here: the turn on screen has not changed.
   *
   * Reuses `commitTurn` rather than `rememberTurn`, because nothing here reads the map back - the
   * working turn's map is exactly what this must not disturb.
   */
  const storeReportOnly = useCallback(
    async (report: ParsedReport, text: string, currentTurn: number) => {
      if (!game) {
        // Should not be reachable - a report cannot be imported at all without an open game - but
        // claiming success here would tell the player a turn is stored when nothing was written.
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: "there is no open game to store it in",
          failed: true,
          warning: false
        });
        return;
      }

      const { warning } = await commitTurn(
        client,
        game,
        report,
        text,
        rulesetText,
        new Date().toISOString()
      );
      setStatus({
        regionCount: 0,
        unitCount: 0,
        message:
          warning ??
          `turn ${report.header.turnNumber} stored for history; still showing turn ${currentTurn}.`,
        failed: false,
        // A message here is always a warning: it is what earns the status line its room back from
        // AppHeader, which hides a message-less status - see applyReport's identical comment.
        warning: true
      });
    },
    [client, game, rulesetText]
  );

  const loadReport = useCallback(
    async (text: string, fileName: string) => {
      setBusy(true);
      try {
        // Whatever was being written belongs to the turn that is about to be replaced. Saved before
        // anything else, because the state below is what tells the flush which draft it is.
        await flush();

        // Classified when the ruleset is to hand, so a unit's men are counted rather than guessed.
        // Without it every unit reads as an estimate, including the single-race majority where the
        // leading-group figure is exactly right.
        const report =
          ruleset.status === "ready"
            ? await client.parseReportClassified(text, ruleset.text)
            : await client.parseReportFull(text);

        const decision = decideReportLoad(
          parsed ? { factionId: parsed.header.factionId, turnNumber: parsed.header.turnNumber } : null,
          { factionId: report.header.factionId, turnNumber: report.header.turnNumber }
        );

        if (decision.kind === "ask") {
          // The question is asked and the load stops here. `busy` is released by the `finally`,
          // because it disables the button that opened this file and a prompt the player cannot
          // answer would be worse than no prompt. A second file dropped while this is up simply
          // replaces the question rather than queueing behind it.
          setPendingOrdersImport(null);
          setPendingLoad({
            report,
            text,
            fileName,
            canMerge: decision.canMerge,
            viewer: {
              factionId: parsed?.header.factionId as string,
              factionLabel: factionLabelOf(parsed) ?? "an unnamed faction",
              turnNumber: parsed?.header.turnNumber ?? null
            },
            incoming: {
              factionLabel: factionLabelOf(report) ?? "an unnamed faction",
              turnNumber: report.header.turnNumber
            }
          });
          return;
        }

        if (decision.kind === "storeOnly") {
          await storeReportOnly(report, text, decision.currentTurn);
          return;
        }

        await applyReport(report, text, fileName);
      } catch (error) {
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: `could not read ${fileName}: ${describeError(error)}`,
          failed: true,
          warning: false
        });
      } finally {
        setBusy(false);
      }
    },
    // `ruleset` belongs here: without it the callback closes over the value at first render, which
    // is null, and every report is parsed unclassified however long the ruleset took to arrive.
    // `parsed` because the decision above is made against whatever is on screen.
    [client, ruleset, parsed, applyReport, storeReportOnly]
  );

  /** Opens the pending report as its own faction: today's behaviour, chosen rather than assumed. */
  const switchFaction = useCallback(() => {
    const pending = pendingLoad;
    if (!pending) {
      return;
    }
    setPendingLoad(null);
    void (async () => {
      setBusy(true);
      try {
        await applyReport(pending.report, pending.text, pending.fileName);
      } finally {
        setBusy(false);
      }
    })();
  }, [pendingLoad, applyReport]);

  /**
   * Folds the pending report into the map and leaves everything else exactly as it is.
   *
   * Deliberately calls none of `setParsed`, `setRawReport`, `setOrdersDocument`, `setSave`,
   * `clearPlan`, `setRoute` or `selectRegion`. The turn on screen has not changed - that is the
   * whole of the difference between merging and switching - so the orders being written, the route
   * being planned and the hex being looked at all stay where the player left them. It will be
   * tempting to make this look more like `applyReport`; that temptation is the bug.
   */
  const mergeReport = useCallback(() => {
    const pending = pendingLoad;
    if (!pending || !pending.canMerge || !game || pending.viewer.turnNumber === null) {
      return;
    }
    setPendingLoad(null);
    void (async () => {
      setBusy(true);
      try {
        const outcome = await mergeTurn(
          client,
          game,
          pending.viewer.factionId,
          pending.viewer.turnNumber as number,
          pending.text,
          rulesetText,
          new Date().toISOString()
        );
        setRemembered(outcome.remembered);
        setMergedReports(outcome.merged);
        setStatus({
          regionCount: outcome.result.mergedRegionCount,
          unitCount: 0,
          message: describeMerge(outcome.result),
          failed: false,
          warning: false
        });
      } catch (error) {
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: `could not merge ${pending.fileName}: ${describeError(error)}`,
          failed: true,
          warning: false
        });
      } finally {
        setBusy(false);
      }
    })();
  }, [pendingLoad, client, game, rulesetText]);

  /**
   * Decides what an orders file dropped on the Import target should do: refuse it outright, or hold
   * it for the player to confirm.
   *
   * Called before any report parse - `importReports` sniffs the file's first line and routes here
   * instead of `loadReport` the moment it recognises `#atlantis`, so an orders file never reaches
   * `client.parseReportClassified` at all.
   */
  const chooseOrdersImport = useCallback(
    (text: string, fileName: string) => {
      if (!game || !parsed || parsed.header.turnNumber === null || parsed.header.factionId === null) {
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: "no turn to apply orders to",
          failed: true,
          warning: false
        });
        return;
      }

      const fileFactionId = ordersFileFaction(text);
      if (fileFactionId !== parsed.header.factionId) {
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message:
            `${fileName} is orders for faction ${fileFactionId ?? "unknown"}, not ` +
            `${factionLabelOf(parsed) ?? "your faction"}`,
          failed: true,
          warning: false
        });
        return;
      }

      const description = describeOrdersImport(text, ordersDocument);
      // The one question a file drop can raise, whichever kind of file it turns out to be - this
      // one replaces a foreign-report question left open exactly as a second report replaces it.
      setPendingLoad(null);
      setPendingOrdersImport({
        text,
        fileName,
        factionLabel: factionLabelOf(parsed) ?? "your faction",
        gameId: game.manifest.metadata.gameId,
        factionId: parsed.header.factionId,
        turnNumber: parsed.header.turnNumber,
        unitCount: description.fileUnitIds.length,
        emptiedCount: description.emptiedUnitIds.length
      });
    },
    [game, parsed, ordersDocument]
  );

  /**
   * Imports everything the player chose, in the order the turns say rather than the order they came.
   *
   * One file is still one file: it goes to `loadReport`, keeps the question that guards a change of
   * faction and the store-only rule that keeps an older turn off the screen, and reports itself
   * through the status line. A selection of two or more is a different act, and gets none of those
   * questions - twenty modals is not a workflow. `reportBatch` decides what happens to each file
   * instead, and the summary dialog is where the player finds out what that was.
   *
   * The map is read back once, at the end. Reading it after every commit is what makes a run of
   * turns slow, and twenty-nine of those reads are of a map nobody ever sees.
   */
  const runBatch = useCallback(
    async (batch: PreparedBatch, viewerFactionId: string | null) => {
      const { read, candidates, unreadable } = batch;
      setBusy(true);
      try {
        const plan = planReportBatch(
          { factionId: viewerFactionId, turnNumber: parsed?.header.turnNumber ?? null },
          candidates
        );
        // The real reason beats the plan's guess for a file that never parsed at all.
        const skipped = plan.skipped.map(
          (skip) => unreadable.find((entry) => entry.index === skip.index) ?? skip
        );

        // Counted over the steps rather than the chosen files: a batch of ten with four skipped
        // would otherwise stop at "6/10" and read like a run that gave up.
        setImportProgress({ done: 0, total: plan.steps.length });

        const failures: BatchSkip[] = [];
        let done = 0;
        for (const step of plan.steps) {
          const source = read[step.index];
          if (!game || !source) {
            // Neither should be reachable - the header only exists inside a game, and a file that
            // would not parse never becomes a step. Recorded rather than skipped silently anyway:
            // a summary that counted this as imported would be claiming a turn nobody has.
            failures.push({
              index: step.index,
              fileName: step.fileName,
              reason: "there was no open game to import it into"
            });
            continue;
          }
          try {
            if (step.kind === "import") {
              const committed = await commitTurn(
                client,
                game,
                source.report,
                source.text,
                rulesetText,
                new Date().toISOString()
              );
              if (committed.warning !== null) {
                throw new Error(committed.warning);
              }
            } else {
              // Under the viewer's faction and the ally's own turn: that turn is the only one an
              // ally's account of a moment can be merged into.
              await mergeTurn(
                client,
                game,
                viewerFactionId as string,
                step.turnNumber,
                source.text,
                rulesetText,
                new Date().toISOString()
              );
            }
          } catch (error) {
            // One report that will not land costs the batch that report. Demoted to a skip so the
            // summary accounts for it, and the walk carries on with the turns that do land.
            failures.push({
              index: step.index,
              fileName: step.fileName,
              reason: describeError(error)
            });
          } finally {
            done += 1;
            setImportProgress({ done, total: plan.steps.length });
          }
        }

        const landed = plan.steps.filter(
          (step) => !failures.some((failure) => failure.index === step.index)
        );

        // What ends up on screen: the batch's newest own turn, applied the way a single report is
        // so that the orders, the selection and the map all land identically.
        //
        // The *last* report of that turn, not the first. Two files can describe one turn - the same
        // report saved twice, or a corrected re-send - and committing overwrites, so the one the
        // database ends up holding is the one chosen last. Showing the first would put a report on
        // screen that disagrees with the map underneath it.
        // (Written as a reverse scan rather than `findLast`, which this project's ES2022 target
        // does not carry.)
        const finish = [...landed]
          .reverse()
          .find((step) => step.kind === "import" && step.turnNumber === plan.finalTurn);
        const source = finish ? read[finish.index] : null;
        if (source && finish && game && viewerFactionId) {
          // Read back rather than committed again: the walk has already written this turn and the
          // allies of it, and a second commit would rewrite the turn's sightings from this report
          // alone, dropping every ally contribution to a hex the viewer also stood in.
          const memory = await readMemory(client, game, viewerFactionId, finish.turnNumber);
          await applyReport(source.report, source.text, finish.fileName, memory);
        } else if (game && viewerFactionId) {
          // Nothing of the viewer's own landed, so the turn on screen has not changed - only the
          // map under it, which the merges have grown.
          const memory = await readMemory(
            client,
            game,
            viewerFactionId,
            parsed?.header.turnNumber ?? null
          );
          setRemembered(memory.remembered);
          setMergedReports(memory.merged);
        }

        setImportSummary({
          steps: landed,
          skipped: [...skipped, ...failures].sort((left, right) => left.index - right.index),
          finalTurn: finish ? plan.finalTurn : null,
          viewerFactionLabel:
            factionLabelOf(source?.report ?? parsed) ?? "an unnamed faction"
        });
      } finally {
        setBusy(false);
        setImportProgress(null);
      }
    },
    [client, rulesetText, parsed, game, applyReport]
  );

  /**
   * Imports everything the player chose, asking first only when the headers cannot say whose it is.
   *
   * Reading and parsing happen here, before anything is written, because the question below needs
   * every header to ask itself - and because a file that will not parse should cost the batch that
   * file and nothing else.
   */
  const importReports = useCallback(
    async (files: File[]) => {
      const only = files[0];
      if (files.length === 1 && only) {
        try {
          const text = await only.text();
          // Sniffed before any report parse: an orders file fed to `parseReportClassified` fails in
          // a way that reads nothing like what actually went wrong. Only on the single-file path -
          // a batch is a run of turns, and an orders file among them is not a case this bead covers.
          if (isOrdersFile(text)) {
            chooseOrdersImport(text, only.name);
          } else {
            await loadReport(text, only.name);
          }
        } catch (error) {
          // `loadReport` answers for everything it does; this is the read that happens before it,
          // for a file that has gone away between being chosen and being opened.
          setStatus({
            regionCount: 0,
            unitCount: 0,
            message: `could not read ${only.name}: ${describeError(error)}`,
            failed: true,
            warning: false
          });
        }
        return;
      }

      setBusy(true);
      setImportProgress({ done: 0, total: files.length });
      let batch: PreparedBatch | null = null;
      try {
        // Whatever was being written belongs to the turn that is about to be replaced. Saved first,
        // exactly as a single report saves it.
        await flush();

        const read: ({ text: string; report: ParsedReport } | null)[] = [];
        const candidates: BatchCandidate[] = [];
        const unreadable: BatchSkip[] = [];
        for (const [index, chosen] of files.entries()) {
          try {
            const text = await chosen.text();
            const report =
              ruleset.status === "ready"
                ? await client.parseReportClassified(text, ruleset.text)
                : await client.parseReportFull(text);
            read.push({ text, report });
            candidates.push({
              fileName: chosen.name,
              factionId: report.header.factionId,
              turnNumber: report.header.turnNumber
            });
          } catch (error) {
            read.push(null);
            // Still a candidate, so the plan's indices stay the indices of the chosen files. Its
            // faction is unreadable, so the plan skips it - but with this reason rather than the
            // plan's, because "could not be read: ..." says what actually went wrong.
            candidates.push({ fileName: chosen.name, factionId: null, turnNumber: null });
            unreadable.push({
              index,
              fileName: chosen.name,
              reason: `could not be read: ${describeError(error)}`
            });
          }
        }
        batch = { read, candidates, unreadable };
      } catch (error) {
        // Reaching here means the draft could not be saved, not that a report would not parse -
        // an unreadable file is caught per file above. Nothing has been written, and the batch is
        // abandoned rather than run: whatever the player was writing is still only in the editor.
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: `could not start the import: ${describeError(error)}`,
          failed: true,
          warning: false
        });
      } finally {
        setBusy(false);
        setImportProgress(null);
      }

      if (!batch) {
        return;
      }

      const choice = chooseViewerFaction(parsed?.header.factionId ?? null, batch.candidates);
      if (choice.kind === "ask") {
        // Held rather than run. Nothing has been written yet, so cancelling costs the player only
        // the reading - and the files are kept parsed so answering does not re-read them.
        setPendingBatch({
          batch,
          options: choice.factionIds.map((factionId) => ({
            factionId,
            label:
              factionLabelOf(
                batch.read.find((entry) => entry?.report.header.factionId === factionId)?.report ??
                  null
              ) ?? `faction ${factionId}`
          }))
        });
        return;
      }

      await runBatch(batch, choice.factionId);
    },
    [client, ruleset, parsed, loadReport, flush, runBatch, chooseOrdersImport]
  );

  // The ruleset is a served file rather than something compiled in, so a movement value can be
  // corrected by editing it and reloading. Which file is the open game's business: a game records
  // the ruleset it is played under, and two games on different servers do not share movement costs.
  // Its absence is not fatal: everything except the planner works without it.
  //
  // Three states rather than a nullable string. "Still arriving" and "not coming" used to look
  // identical, and a report opened during the fetch was quietly parsed unclassified - which makes
  // every unit's man-count an estimate, including the single-race majority where the leading-group
  // figure is exactly right. Nothing said so.
  useEffect(() => {
    if (!game) {
      setRuleset({ status: "unavailable" });
      return undefined;
    }

    let cancelled = false;
    setRuleset({ status: "loading" });
    void Promise.resolve()
      .then(() => fetch(rulesetUrlFor(game.manifest.metadata.rulesetId)))
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        if (!cancelled) {
          setRuleset(text === null ? { status: "unavailable" } : { status: "ready", text });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuleset({ status: "unavailable" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [game]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => client.orderCommands())
      .then((commands) => {
        if (!cancelled) {
          setOrderCommands(commands);
        }
      })
      .catch(() => {
        // Completion is a convenience; the editor works without it.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  /**
   * Puts back the turn the player was last working on.
   *
   * Everything here was already on disk and none of it was ever read back: opening a game showed an
   * empty workspace over a database holding the turn, the map it accumulated and its orders. This
   * is the half of issue #34 that is not about saving.
   *
   * It waits for the ruleset to settle rather than running as soon as the game opens. `loading` and
   * `unavailable` used to be the same value, so restoring on the first render would parse the
   * report unclassified whenever the fetch had not landed yet - and every unit's man-count would
   * read as an estimate for no reason but timing. Waiting costs a moment; parsing twice to fix it
   * afterwards costs the redundancy issue #28 exists to remove.
   *
   * Keyed on the game and on the ruleset settling, not on `parsed`: this must not re-run when the
   * player then opens a report of their own.
   */
  useEffect(() => {
    if (!game || ruleset.status === "loading") {
      return undefined;
    }

    let cancelled = false;
    setBusy(true);
    const parse = (text: string) =>
      ruleset.status === "ready"
        ? client.parseReportClassified(text, ruleset.text)
        : client.parseReportFull(text);

    void restoreLatestTurn(client, game, parse)
      .then((restored) => {
        if (cancelled || !restored) {
          return;
        }
        // Whether a turn is already on screen when this lands, read at resolve time. Opening a
        // game clears `parsed`, so this is false on every plain open - and true when the player
        // imported a report while the restore was still waiting on the ruleset fetch, or when a
        // ruleset change re-runs this to re-parse. In both of those the orders on screen are
        // newer than the stored snapshot: the player has been typing while storage stood still,
        // and re-applying the snapshot wiped their words. The turn itself is still applied - a
        // re-parse is the second case's whole purpose.
        const turnAlreadyShowing = displayedTurn.current !== null;
        setParsed(restored.parsed);
        setRawReport(restored.rawReport);
        setRemembered(restored.remembered);
        // Whose reports were folded into this turn. Without it a reopened game shows the merged
        // hexes with nothing to say where they came from, which is the question the chip answers.
        setMergedReports(restored.merged);
        if (!turnAlreadyShowing) {
          setOrdersDocument(restored.orders);
          setSave(savedStateFor(restored.ordersSavedAt));
        }

        const unitCount = restored.parsed.regions.reduce(
          (total, region) => total + region.units.length,
          0
        );
        setStatus({
          regionCount: restored.parsed.regions.length,
          unitCount,
          message: restored.warning ?? `restored turn ${restored.turnNumber}`,
          failed: false,
          warning: restored.warning !== null
        });

        // Opening on a hex the player has units in, exactly as loading a report does — unless a
        // hex is already selected. This effect also re-runs after a ruleset change re-parse, and
        // yanking the player to the opening hex would make the settings dialog feel like a reload.
        const opening = buildHexMapModel(restored.parsed);
        const selected = useWorkspaceStore.getState().selectedRegionId;
        const landing = selected ?? opening.initialSelectedRegionId;
        const landingHex = opening.hexes.find((candidate) => candidate.regionId === landing);
        const firstUnit = unitsForHex(landingHex ?? null)[0]?.unitId ?? null;

        if (selected === null) {
          selectRegion(landing, firstUnit);
          return;
        }
        // A hex restored from storage arrives without a unit, because storage holds no unit: the
        // hex is a place on the map and outlives a turn, while a unit id may not survive to the
        // next one. Filling it in here is what stops a reopened game showing a selected hex over
        // an empty unit panel - and it is only ever filled in, never replaced.
        if (useWorkspaceStore.getState().selectedUnitId === null && firstUnit !== null) {
          selectUnit(firstUnit);
        }
      })
      .catch((error: unknown) => {
        // A game whose stored turn will not come back must say so. Silence here is exactly the
        // empty workspace this issue is about, only now with a reason nobody can see.
        if (!cancelled) {
          setStatus({
            regionCount: 0,
            unitCount: 0,
            message: `the last turn could not be restored: ${describeError(error)}`,
            failed: true,
            warning: false
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, game, ruleset, selectRegion, selectUnit]);

  /** Re-reads the list of games. Every change to a game changes what the picker should show. */
  const refreshGames = useCallback(async () => {
    setGames(await client.listGames());
  }, [client]);

  /**
   * Moves the workspace into a game.
   *
   * Everything the previous game put on screen goes with it. A report belongs to the game it was
   * imported into, and leaving one turn's map and orders standing under another game's name would
   * be worse than showing nothing.
   */
  const enterGame = useCallback(
    (opened: OpenedGame) => {
      setGame(opened);
      setParsed(null);
      setRemembered([]);
      setRawReport("");
      setOrdersDocument("");
      setStatus(null);
      setSave({ kind: "clean" });
      setRoute(null);
      clearPlan();
      // A question raised in the game being left must not be answered into the game being entered:
      // the prompt holds a faction id and a turn that belong to another database entirely. The
      // batch's question carries a whole selection of parsed reports and would write them into
      // whichever game is open when it is answered; the summary describes a game nobody is in.
      setPendingLoad(null);
      setPendingBatch(null);
      setImportSummary(null);
      setMergedReports([]);
      setMergedOpen(false);
      // A new game redefines what there is to compare, and the comparison held so far names a
      // turn in the database being left.
      setComparison(null);
      setTurnPickerOpen(false);
      setTurnSummaries([]);
      openGameInStore({
        gameId: opened.manifest.metadata.gameId,
        gameName: opened.manifest.metadata.gameName,
        databasePath: opened.databasePath,
        rulesetId: opened.manifest.metadata.rulesetId
      });

      // Back to the level and the hex this game was left on. Applied here rather than after the
      // turn is restored so that all three - the game, the level and the selection - reach the map
      // in one render, and the map's own restore cannot be raced by a level arriving later.
      //
      // `setLevel` clears the selection, so the hex has to follow it rather than lead. A saved hex
      // also stands the opening-hex fallback down, which is what used to pull the restored view
      // back to wherever the faction's first unit happened to be standing.
      //
      // The level is set whether or not one was saved: it is the only part of the view the store
      // keeps across a game switch, so a game with nothing saved would otherwise open on whichever
      // level the game before it was left on.
      const saved = loadSavedView(opened.manifest.metadata.gameId);
      setLevel(saved?.level ?? DEFAULT_LEVEL);
      if (saved?.regionId != null) {
        // A silent restore, not a user-initiated change - it must not replay the lock-on pulse.
        restoreSelection(saved.regionId);
      }
    },
    [clearPlan, openGameInStore, setLevel, restoreSelection]
  );

  const openGameById = useCallback(
    async (gameId: string) => {
      setBusy(true);
      setGameError(null);
      try {
        // Before the workspace lets go of the old game. `enterGame` wipes the document, and
        // whatever was in it belongs to a game the player is walking away from.
        await flush();
        enterGame(await client.openGame(gameId, new Date().toISOString()));
        await refreshGames();
        setPickerOpen(false);
      } catch (error: unknown) {
        setGameError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [client, enterGame, refreshGames, flush]
  );

  /**
   * Moves the open game to another ruleset, and re-reads the world under it.
   *
   * Handing `setGame` a fresh object is the second half of the change: the ruleset fetch effect is
   * keyed on `game`, so the new identity makes it fetch the new ruleset, and the turn-restore
   * effect then re-parses the stored turn under it. Without that, every unit count would silently
   * keep the old ruleset's reading until the next manual reload.
   */
  const changeRuleset = useCallback(
    async (rulesetId: string) => {
      if (!game || game.manifest.metadata.rulesetId === rulesetId) {
        return;
      }
      // This build has to be able to fetch what it is about to store; the backend deliberately
      // stores ids as opaque strings, so this is the only gate.
      if (!rulesetById(rulesetId)) {
        setGameError(`unknown ruleset: ${rulesetId}`);
        return;
      }
      setBusy(true);
      setGameError(null);
      try {
        // The re-restore below re-reads orders from the database, so the draft must be there first.
        await flush();
        const manifest = await client.setGameRuleset(game.manifest.metadata.gameId, rulesetId);
        setGame({ ...game, manifest });
        updateGameRulesetInStore(rulesetId);
        await refreshGames();
      } catch (error: unknown) {
        setGameError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [client, game, flush, refreshGames, updateGameRulesetInStore]
  );

  const createGame = useCallback(
    async (name: string, rulesetId: string) => {
      setBusy(true);
      setGameError(null);
      try {
        await flush();
        const now = new Date().toISOString();
        enterGame(await client.createGame(newGameManifest(name, rulesetId, now, newGameId())));
        await refreshGames();
        setPickerOpen(false);
      } catch (error: unknown) {
        setGameError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [client, enterGame, refreshGames, flush]
  );


  // On startup, reopen the game the player was last in. No games is the ordinary first run, and
  // the gate below answers it.
  //
  // Through `enterGame` like every other way into a game, so the workspace store learns which game
  // is open here too. Setting the local state alone left the store saying `null` while the app
  // displayed a game, and the next panel to read it would have believed the store.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const opened = await openNewestGame(client, new Date().toISOString());
        if (!cancelled && opened) {
          enterGame(opened);
        }
        if (!cancelled) {
          setGames(await client.listGames());
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setGameError(describeError(error));
        }
      } finally {
        if (!cancelled) {
          setGamesLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, enterGame]);

  /**
   * Deletes a game and lands the player somewhere.
   *
   * Deleting the game on screen leaves the workspace describing something that no longer exists,
   * so the next most recently opened game takes its place - or the gate does, when that was the
   * last one.
   *
   * Nothing is flushed on the way out. Deleting the open game destroys the database its orders
   * would be written to, and the `enterGame` below would otherwise try to save into it on the way
   * to the next game. Deleting some other game leaves the open document exactly where it was.
   */
  const deleteGame = useCallback(
    async (gameId: string) => {
      setBusy(true);
      setGameError(null);
      try {
        if (game?.manifest.metadata.gameId === gameId) {
          writer.discard();
        }
        await client.deleteGame(gameId);
        const remaining = await client.listGames();
        setGames(remaining);

        if (game?.manifest.metadata.gameId === gameId) {
          const next = gameAfterDelete(remaining, gameId);
          if (next) {
            enterGame(await client.openGame(next.metadata.gameId, new Date().toISOString()));
          } else {
            setGame(null);
            closeGameInStore();
          }
        }
        setPickerOpen(false);
      } catch (error: unknown) {
        setGameError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [client, enterGame, game, closeGameInStore, writer]
  );

  const exportGameBackup = useCallback(
    async (gameId: string) => {
      setBusy(true);
      setGameError(null);
      try {
        await flush();
        const backup = await client.exportGame(gameId, new Date().toISOString());
        const path = await deliverGameBackupExport(saveTextFile, gameId, backup);
        if (path === null) {
          // The player cancelled the native save. Nothing was written, so the picker stays open
          // rather than claiming an export that never happened.
          return;
        }
        setPickerOpen(false);
      } catch (error: unknown) {
        setGameError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [client, flush, saveTextFile]
  );

  const importGameBackup = useCallback(
    async (file: File) => {
      setBusy(true);
      setGameError(null);
      try {
        await flush();
        const backupJson = await file.text();
        enterGame(await client.importGame(backupJson, new Date().toISOString()));
        await refreshGames();
        setPickerOpen(false);
        setSettingsOpen(false);
      } catch (error: unknown) {
        setGameError(`could not import ${file.name}: ${describeError(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [client, enterGame, refreshGames, flush]
  );

  // A destination and a unit are all the planner needs; the answer carries either a route or the
  // reason there is none.
  useEffect(() => {
    const destination = planner.destinationId;
    if (!destination || !unit?.own || ruleset.status !== "ready" || !rawReport) {
      return undefined;
    }

    let cancelled = false;
    setPlanning(true);
    void client
      .planRoute(ruleset.text, rawReport, rememberedJson, unit.unitId, destination)
      .then((answer) => {
        if (!cancelled) {
          setRoute(answer);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({
            regionCount: 0,
            unitCount: 0,
            message: `could not plan a route: ${describeError(error)}`,
            failed: true,
            warning: false
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPlanning(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, planner.destinationId, unit, ruleset, rawReport, rememberedJson]);

  // A trace answers a question about one unit, so it must not outlive the selection that asked
  // it: without this, unit A's path stays on the map for the debounce-plus-round-trip it takes
  // unit B's own trace to arrive - or forever, when that trace fails.
  const selectedForTrace = unit?.own ? unit.unitId : null;
  useEffect(() => {
    setOrderTrace(null);
  }, [selectedForTrace]);

  // The selected unit's written movement order, traced across the remembered map as the player
  // types, on the same debounce rhythm as validation. The overlay is advisory, so a trace that
  // fails leaves the last one standing rather than replacing the line with an error. Skipped
  // entirely while the movement layer is off: the answer could not be drawn, and toggling the
  // layer back on re-runs this and asks again.
  useEffect(() => {
    const orders = (unit?.own ? readUnitOrders(ordersDocument, unit.unitId) : null) ?? "";
    if (!layers.movement || !unit?.own || !orders.trim() || ruleset.status !== "ready" || !rawReport) {
      setOrderTrace(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void client
        .traceMoveOrders(ruleset.text, rawReport, rememberedJson, unit.unitId, orders)
        .then((answer) => {
          if (!cancelled) {
            setOrderTrace(answer);
          }
        })
        .catch(() => undefined);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, unit, ordersDocument, ruleset, rawReport, rememberedJson, layers.movement]);

  // Validation follows the document, debounced so it does not run on every keystroke. Kept whole
  // rather than counted here: the orders panel shows one unit, and which of these belong to it is a
  // question only the panel can answer - one it answers by line number, which is why the text that
  // was validated is kept alongside the answer rather than thrown away.
  //
  // Cancelled on the way out as well as debounced. Two validations can be in flight at once and
  // there is no promise that they finish in order, so without this an older reply can land last and
  // leave the panel pointing at lines that moved several keystrokes ago.
  useEffect(() => {
    if (!ordersDocument) {
      setValidated({ text: "", diagnostics: [] });
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void client
        // The ruleset is what lets an item name be checked against the catalogue. It arrives
        // asynchronously, so this effect re-runs when it lands and the item warnings appear then.
        // The report is what the checks beyond syntax read - who holds what, who guards where.
        // It goes across as text, which is what the core keys its cached parse on, so the
        // whole-map pass this runs costs one walk of the orders and no re-parse of the turn.
        .validateOrders(ordersDocument, rulesetText, rawReport || null, {
          warnOnUnguardedHex
        })
        .then((result) => {
          if (!cancelled) {
            setValidated({ text: ordersDocument, diagnostics: result.diagnostics });
          }
        })
        // A validation that will not run leaves the last one standing rather than replacing it with
        // an empty verdict. Saying "0 errors" because the check failed is the one answer worse than
        // an answer a few keystrokes old, and validation is advisory in any case - the server has
        // the last word on every order. Without this the rejection is unhandled and the state stays
        // stale anyway, silently.
        .catch(() => undefined);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, ordersDocument, rulesetText, rawReport, warnOnUnguardedHex]);

  /**
   * What the checks found, hex by hex, for the header chip and the list it opens.
   *
   * Only the findings that belong to a hex. Syntax diagnostics are already counted by the orders
   * panel, against the unit whose line they sit on, and counting them twice under two different
   * headings would read as two separate problems.
   */
  const problemsByHex = useMemo(() => findingsByHex(validated.diagnostics), [validated]);

  // The whole document previewed at once, unlike the per-unit trace, because GIVE crosses units
  // and MOVE crosses hexes: only the full text says what a hex looks like next month. Same
  // debounce, same stale-reply guard, same policy of leaving the last answer standing on failure -
  // the preview is advisory, and the server has the last word on every order.
  useEffect(() => {
    if (!ordersDocument || ruleset.status !== "ready" || !rawReport) {
      setOrdersPreview(null);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void client
        .previewOrders(ruleset.text, rawReport, rememberedJson, ordersDocument)
        .then((answer) => {
          if (!cancelled) {
            setOrdersPreview(answer);
          }
        })
        .catch(() => undefined);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, ordersDocument, ruleset, rawReport, rememberedJson]);

  /** The selected hex's slice of the preview, or nothing when the orders leave it alone. */
  const hexPreview = useMemo<RegionPreview | null>(() => {
    if (!hex || !ordersPreview) {
      return null;
    }
    return ordersPreview.regions.find((region) => region.regionId === hex.regionId) ?? null;
  }, [hex, ordersPreview]);

  /** The selected unit as the orders leave it, for the unit panel. */
  const unitPreview = useMemo(() => {
    if (!unit || !hexPreview) {
      return null;
    }
    return hexPreview.units.find((previewed) => previewed.unit.unitId === unit.unitId) ?? null;
  }, [unit, hexPreview]);

  /** The faction and turn the document in front of the player belongs to. */
  const draftKey = useMemo(() => draftKeyFor(parsed), [parsed]);

  const onOrdersChange = useCallback(
    (unitId: string, orders: string) => {
      setOrdersDocument((document) => {
        const next = writeUnitOrders(document, unitId, orders);
        writer.markDirty(game, draftKey, next);
        return next;
      });
    },
    [game, draftKey, writer]
  );

  /**
   * Applies the confirmed orders import: the file text becomes the document, through the same
   * writer path typing takes, then the whole thing is validated so a dirty import can say what is
   * wrong with it.
   *
   * `setOrdersDocument` and `writer.markDirty` are called together, exactly as `onOrdersChange`
   * calls them - never `setOrdersDocument` alone, which would leave the autosave writing whatever
   * it was last told rather than what is now on screen.
   */
  const replaceOrdersImport = useCallback(() => {
    const pending = pendingOrdersImport;
    if (!pending) {
      return;
    }
    setPendingOrdersImport(null);

    // The game, faction or turn on screen can have moved since the prompt was raised - a report
    // that loaded without asking, a different game or turn picked while this sat open. The counts
    // the player just confirmed described that earlier turn, not necessarily this one, so a
    // mismatch refuses rather than writing the file into whatever draft happens to be open now.
    const stillCurrent =
      game?.manifest.metadata.gameId === pending.gameId &&
      parsed?.header.factionId === pending.factionId &&
      parsed?.header.turnNumber === pending.turnNumber;
    if (!stillCurrent) {
      setStatus({
        regionCount: 0,
        unitCount: 0,
        message: `could not import ${pending.fileName}: the open turn changed before Replace was pressed`,
        failed: true,
        warning: false
      });
      return;
    }

    void (async () => {
      setBusy(true);
      try {
        setOrdersDocument(pending.text);
        writer.markDirty(game, draftKey, pending.text);

        const result = await client.validateOrders(pending.text, rulesetText, rawReport || null, {
          warnOnUnguardedHex
        });

        if (result.diagnostics.length > 0) {
          setOrdersImportSummary({
            unitCount: pending.unitCount,
            diagnostics: result.diagnostics,
            document: pending.text
          });
        } else {
          setStatus({
            regionCount: 0,
            unitCount: pending.unitCount,
            message: `orders imported: ${pending.unitCount} unit${pending.unitCount === 1 ? "" : "s"}`,
            failed: false,
            warning: false
          });
        }
      } catch (error) {
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: `could not import ${pending.fileName}: ${describeError(error)}`,
          failed: true,
          warning: false
        });
      } finally {
        setBusy(false);
      }
    })();
  }, [
    pendingOrdersImport,
    client,
    game,
    parsed,
    draftKey,
    writer,
    rulesetText,
    rawReport,
    warnOnUnguardedHex
  ]);

  /** Writes a planned route into the selected unit's block, replacing any MOVE already there. */
  const applyRoute = useCallback(
    (order: string) => {
      if (!unit) {
        return;
      }
      setOrdersDocument((document) => {
        const existing = readUnitOrders(document, unit.unitId) ?? "";
        const withoutMove = stripMovementOrderLines(existing);
        const next = withoutMove ? `${withoutMove}\n${order}` : order;
        const written = writeUnitOrders(document, unit.unitId, next);
        writer.markDirty(game, draftKey, written);
        return written;
      });
    },
    [unit, game, draftKey, writer]
  );

  /**
   * The autosave: five seconds after the last keystroke, and thirty at the outside.
   *
   * The idle timer re-arms on every edit, which is what keeps a sentence from being written a
   * character at a time. On its own it has a hole: someone writing steadily for ten minutes never
   * pauses, so nothing is ever written, and that is exactly the session worth protecting. The
   * ceiling is measured from when the document first went dirty and is not re-armed, so it closes
   * that hole without turning the idle rule back into a ticker.
   *
   * "failed" arms them too. A write that could not land leaves the text owed, and leaving it owed
   * until the player happens to type again would make a passing database hiccup cost the rest of
   * the session. Retrying is one UPSERT; the panel keeps showing the reason until one lands.
   */
  useEffect(() => {
    if (save.kind !== "dirty" && save.kind !== "failed") {
      return undefined;
    }
    const since = writer.dirtySince() ?? Date.now();
    const idle = window.setTimeout(() => void flush(), AUTOSAVE_IDLE_MS);
    const ceiling = window.setTimeout(
      () => {
        // Asked rather than assumed: a timer scheduled against a wall clock can fire early, and a
        // machine that slept can fire it very late. The predicate is the rule; the timer only says
        // when to check it.
        if (shouldTriggerAutosave(since, Date.now(), AUTOSAVE_CEILING_MS)) {
          void flush();
        }
      },
      Math.max(0, since + AUTOSAVE_CEILING_MS - Date.now())
    );
    return () => {
      window.clearTimeout(idle);
      window.clearTimeout(ceiling);
    };
    // `ordersDocument` is what re-arms the idle timer: every edit replaces the document, and
    // `save.kind` alone stays "dirty" across all of them. `save` rather than `save.kind` so a
    // second failure re-arms rather than looking like the same state to the dependency check.
  }, [save, ordersDocument, flush, writer]);

  /**
   * Saving on the way out.
   *
   * `pagehide` fires when a tab closes, when the page is reloaded and when the player navigates
   * away; `visibilitychange` catches the phone or laptop being put down, which on mobile is often
   * the last event a page ever gets. Neither can be awaited - the browser is leaving - so the write
   * is started and the thirty-second ceiling is what bounds the loss when it does not finish.
   *
   * `beforeunload` is deliberately not used. It is the least reliable of the three on mobile, and
   * its only real power is prompting the player to stay, which is a worse answer than saving.
   */
  useEffect(() => {
    const onHide = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        void flush();
      }
    };

    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush]);

  /**
   * The native close, when the shell offers one.
   *
   * This one can be awaited: the desktop holds the window open until the write finishes, so a quit
   * loses nothing at all rather than nearly nothing.
   */
  useEffect(() => registerBeforeQuit?.(flush), [registerBeforeQuit, flush]);

  /** The report's own long-format template, or null when it carries none to restore from. */
  const ordersTemplateText = parsed?.ordersTemplate?.text ?? null;

  const exportOrders = useCallback(() => {
    void deliverOrdersExport(saveTextFile, parsed?.header.turnNumber, ordersDocument, ordersTemplateText, false);
  }, [ordersDocument, ordersTemplateText, parsed, saveTextFile]);

  /**
   * The same file, with the server's long-format unit descriptions put back in - see issue #52.
   * Same name as the plain export: it is the same orders file, and a second name would suggest a
   * second kind of file.
   */
  const exportOrdersLong = useCallback(() => {
    void deliverOrdersExport(saveTextFile, parsed?.header.turnNumber, ordersDocument, ordersTemplateText, true);
  }, [ordersDocument, ordersTemplateText, parsed, saveTextFile]);

  /**
   * Opens the export dialog on a clean slate.
   *
   * The failure of a previous attempt belongs to that attempt: a message left standing in a
   * freshly opened dialog reads as something already wrong with the export in front of the player.
   */
  // A rectangle belongs to the map it was dragged on. Switching game, loading another turn or
  // changing level leaves it describing somewhere else, so it goes and the dialog falls back to
  // the bounds of what is known here.
  useEffect(() => {
    setExportRect(null);
  }, [game?.manifest.metadata.gameId, level, rawReport]);

  const openExport = useCallback((rect?: MapRect) => {
    if (rect) {
      setExportRect(rect);
    }
    setExportError(null);
    setExportOpen(true);
  }, []);

  /**
   * Writes the chosen rectangle out as a report-shaped file for an ally to read.
   *
   * The core is handed the same pair the planner takes - this turn's report and the remembered
   * map - so what is exported is everything known about the area, not just the hexes described
   * this month.
   */
  const exportMap = useCallback(
    async (rect: MapRect, content: MapExportContent) => {
      if (!rawReport) {
        return;
      }
      setExportBusy(true);
      setExportError(null);
      try {
        const text = await client.exportMap(
          rawReport,
          rememberedJson,
          exportRequestOf(rect, level, content)
        );
        const fileName = exportFileName(parsed?.header.turnNumber ?? null, level);

        // A shell that can put the file where the player asks does, and the player picked the
        // place, so nothing needs to tell them afterwards where it went. The browser gets the
        // download it is capable of. A cancelled save dialog leaves the export dialog standing:
        // nothing was written, and closing it would look as though something had been.
        const path = await deliverTextFile(saveTextFile, fileName, text, "text/plain");
        if (path === null) {
          return;
        }
        setExportOpen(false);
      } catch (error: unknown) {
        setExportError(describeError(error));
      } finally {
        setExportBusy(false);
      }
    },
    [client, level, parsed, rawReport, rememberedJson, saveTextFile]
  );

  const factionLabel = factionLabelOf(parsed);
  const turnLabel =
    parsed?.header.turnNumber === null || parsed?.header.turnNumber === undefined
      ? null
      : `${parsed.header.turnNumber} · ${parsed.header.month}, Year ${parsed.header.year}`;

  /**
   * Opens or closes the turn picker, fetching the turns it lists only on the way open - a list
   * nobody asked to see is a database read this workspace does not need to make on every report
   * load, and closing the picker is not a reason to make it either.
   */
  const handleOpenTurnPicker = useCallback(async () => {
    const opening = !turnPickerOpen;
    setTurnPickerOpen(opening);
    if (!opening || !game || !parsed?.header.factionId) {
      return;
    }
    const gameId = game.manifest.metadata.gameId;
    const factionId = parsed.header.factionId;
    const summaries = await client.listImportedTurns(game.databasePath, gameId);
    setTurnSummaries(summaries.filter((summary) => summary.key.factionId === factionId));
  }, [client, game, parsed, turnPickerOpen]);

  /**
   * Starts, switches or stops comparing against the clicked turn.
   *
   * Loads a turn only via `client.loadImportedTurn` (through `loadComparisonTurn`) and holds it in
   * `comparison` - never `setParsed`. The working turn's draft is keyed off `parsed`, and every
   * keystroke autosaves under that key; pointing `parsed` at the compared turn would make the next
   * autosave silently overwrite *that* turn's stored draft, in an app with no undo.
   *
   * Every exit here either starts/changes/clears the comparison or puts something on the status
   * line - a click that resolved neither used to fail silently on desktop with no dialog and no
   * explanation (ah-6l2).
   *
   * A comparison failure is reported as a `warning`, not `failed`: `failed` is the working turn's
   * own "this report did not load" state, and AppHeader withholds the turn-messages chip while it
   * is set (see its comment) - a compared turn that could not be loaded says nothing about the
   * working turn already on screen, so it must not hide that chip or read as a red, not amber, dot.
   */
  const handleSelectComparisonTurn = useCallback(
    async (clickedTurn: number) => {
      const reportComparisonFailure = (message: string) =>
        setStatus({ regionCount: 0, unitCount: 0, message, failed: false, warning: true });

      const workingTurn = parsed?.header.turnNumber ?? null;
      if (workingTurn === null || !game || !parsed?.header.factionId) {
        reportComparisonFailure(`could not load turn ${clickedTurn} for comparison`);
        setTurnPickerOpen(false);
        return;
      }
      const currentTurn = comparison?.key.turnNumber ?? null;
      const next = toggleComparison(currentTurn, clickedTurn, workingTurn);
      // Clicking the working turn: changes nothing, including an active comparison. Only the
      // picker closes.
      if (next === currentTurn) {
        setTurnPickerOpen(false);
        return;
      }
      if (next === null) {
        setComparison(null);
        setTurnPickerOpen(false);
        return;
      }
      const gameId = game.manifest.metadata.gameId;
      const factionId = parsed.header.factionId;
      const parse = (text: string) =>
        ruleset.status === "ready"
          ? client.parseReportClassified(text, ruleset.text)
          : client.parseReportFull(text);
      try {
        const comparisonTurn = await loadComparisonTurn(
          client,
          game.databasePath,
          gameId,
          factionId,
          next,
          parse
        );
        setComparison(comparisonTurn);
        setTurnPickerOpen(false);
      } catch (error: unknown) {
        reportComparisonFailure(`could not load turn ${next} for comparison: ${describeError(error)}`);
        setTurnPickerOpen(false);
      }
    },
    [client, comparison, game, parsed, ruleset]
  );

  const comparedTurnChip = comparisonChipLabel(
    parsed?.header.turnNumber ?? 0,
    comparison?.key.turnNumber ?? null
  );

  // An open dialog reading a comparison that just vanished - game switch, a new working turn, or
  // the Turn chip's own ✕ - would show a blank or crash. One effect, keyed on the comparison
  // itself, closes it and forgets the orders it had loaded for the pair that is gone.
  useEffect(() => {
    if (!comparison) {
      setChangesOpen(false);
      setComparedOrders(null);
    }
  }, [comparison]);

  // A tab read for one compared pair is not necessarily one the next pair should open on -
  // switching to a different compared turn starts the dialog back on Units, the default.
  useEffect(() => {
    setChangesTab("units");
  }, [comparison?.key.turnNumber]);

  // Loaded on the dialog's first open for a given compared turn, not eagerly: nobody asked to see
  // it and a stored draft read is a database hit this workspace does not need to make on every
  // comparison pick.
  useEffect(() => {
    if (!changesOpen || !comparison || !game) {
      return;
    }
    if (comparedOrders?.turnNumber === comparison.key.turnNumber) {
      return;
    }
    let cancelled = false;
    void (async () => {
      // A failed read falls back to the template, exactly as `documentFor` (`orderDraft.ts`)
      // does for the working turn's own draft - a database that will not open is not a reason
      // to tell the player their compared turn never had orders.
      let orderText: string | null = null;
      try {
        const draft = await client.loadOrderDraft(
          game.databasePath,
          game.manifest.metadata.gameId,
          comparison.key.factionId,
          comparison.key.turnNumber
        );
        orderText = draft?.orderText ?? null;
      } catch {
        orderText = null;
      }
      if (cancelled) {
        return;
      }
      const text = orderText ?? comparison.parsed.ordersTemplate?.text ?? null;
      setComparedOrders({ turnNumber: comparison.key.turnNumber, text });
    })();
    return () => {
      cancelled = true;
    };
  }, [changesOpen, comparison, game, client, comparedOrders]);

  /**
   * What changed between the working turn and the compared one, oriented lower turn number ->
   * higher regardless of which side is the working one - `diffTurns`/`diffOrders` are symmetric
   * in neither direction, so the orientation is this shell's call, made once, here.
   */
  const turnDiff = useMemo(() => {
    const workingTurn = parsed?.header.turnNumber ?? null;
    if (!parsed || !comparison || workingTurn === null) {
      return null;
    }
    const comparedTurn = comparison.key.turnNumber;
    const [[olderTurn, older], [newerTurn, newer]]: [[number, ParsedReport], [number, ParsedReport]] =
      workingTurn <= comparedTurn
        ? [[workingTurn, parsed], [comparedTurn, comparison.parsed]]
        : [[comparedTurn, comparison.parsed], [workingTurn, parsed]];
    return { diff: diffTurns(older, newer), older, newer, olderTurn, newerTurn };
  }, [parsed, comparison]);

  const ordersDiff = useMemo(() => {
    const workingTurn = parsed?.header.turnNumber ?? null;
    if (!turnDiff || !comparison || workingTurn === null) {
      return null;
    }
    if (comparedOrders?.turnNumber !== comparison.key.turnNumber || comparedOrders.text === null) {
      return null;
    }
    const comparedTurn = comparison.key.turnNumber;
    return workingTurn <= comparedTurn
      ? diffOrders(ordersDocument, comparedOrders.text)
      : diffOrders(comparedOrders.text, ordersDocument);
  }, [turnDiff, comparison, comparedOrders, parsed, ordersDocument]);

  // A null `ordersDiff` means two different things - "nothing to compare" and "the compared
  // draft has not loaded yet" - and `ordersEmptyText` alone cannot tell them apart. This does,
  // so the dialog says "loading" rather than the more confident, and here wrong, "not known".
  const comparedOrdersLoading =
    changesOpen && comparison !== null && comparedOrders?.turnNumber !== comparison.key.turnNumber;

  const changesTabsList = useMemo(
    () => (turnDiff ? changesTabs(turnDiff.diff, ordersDiff) : []),
    [turnDiff, ordersDiff]
  );
  const changesUnitRows = useMemo(
    () => (turnDiff ? unitRows(turnDiff.diff.units, turnDiff.older, turnDiff.newer) : []),
    [turnDiff]
  );
  const changesRegionRows = useMemo(
    () => (turnDiff ? regionRows(turnDiff.diff.regions, turnDiff.older, turnDiff.newer) : []),
    [turnDiff]
  );
  const changesOrderRows = useMemo(
    () => (ordersDiff && turnDiff ? orderRows(ordersDiff, turnDiff.older, turnDiff.newer) : []),
    [ordersDiff, turnDiff]
  );

  /**
   * Selecting a changed unit or region is the way back to it: select on the map, close the
   * dialog. The dialog computes nothing else, following `BattlesDialog`'s `onShowOnMap`.
   *
   * The map only ever renders the *working* turn, whichever side of the comparison that is - a
   * row naming a unit or region that exists only on the *other* side (added-only, removed-only,
   * or seen on only one side) carries an id the working map has never heard of. `goToUnit`
   * already answers "is this unit on the map I am showing" via `unitRegions`, so it is tried
   * first and only falls back to the row's own `regionId` - still worth selecting, since a
   * region can exist on the map even when the unit that once stood in it does not - when the
   * unit is not one of the working turn's own.
   */
  const handleSelectChangedUnit = useCallback(
    (unitId: string, regionId: string) => {
      if (unitRegions.has(unitId)) {
        goToUnit(unitId);
      } else {
        selectHex(regionId);
      }
      setChangesOpen(false);
    },
    [unitRegions, goToUnit, selectHex]
  );
  const handleSelectChangedRegion = useCallback(
    (regionId: string) => {
      selectHex(regionId);
      setChangesOpen(false);
    },
    [selectHex]
  );

  // Nothing until the games are known: rendering the gate first and the workspace a moment later
  // would flash "no game yet" at a player who has several.
  if (!gamesLoaded) {
    return <div className="h-full bg-ground" />;
  }

  // The same dialog on both screens below, because settings are not part of the workspace: they
  // are part of the application, and the application exists before any game does.
  const settingsPanel = (
    <SettingsDialog
      platformLabel={platformLabel}
      appUpdate={appUpdate}
      game={
        game
          ? {
              gameId: game.manifest.metadata.gameId,
              gameName: game.manifest.metadata.gameName,
              databasePath: game.databasePath,
              rulesetId: game.manifest.metadata.rulesetId
            }
          : null
      }
      busy={busy}
      error={gameError}
      onChangeRuleset={(rulesetId) => void changeRuleset(rulesetId)}
      onDismiss={() => setSettingsOpen(false)}
    />
  );

  // The keyboard layer's surfaces, mounted beside the settings dialog for the same reason it
  // is: they belong to the application, whichever screen is up.
  const keyboardPanels = (
    <>
      {paletteOpen ? (
        <CommandPalette entries={paletteEntries} onDismiss={() => setPaletteOpen(false)} />
      ) : null}
      {helpOpen ? <ShortcutHelp isMac={isMacPlatform()} onDismiss={() => setHelpOpen(false)} /> : null}
    </>
  );

  // No game means there is nowhere to put a report, an order or a remembered map, so the workspace
  // is not rendered at all and creating a game is the only thing on offer.
  if (!game) {
    return (
      <>
      <GameGate
        busy={busy}
        error={gameError}
        onCreate={(name, rulesetId) => void createGame(name, rulesetId)}
        onImport={(file) => void importGameBackup(file)}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        settings={settingsPanel}
      />
      {keyboardPanels}
    </>
    );
  }

  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      <AppHeader
        gameName={game.manifest.metadata.gameName}
        pickerOpen={pickerOpen}
        onTogglePicker={() => {
          setGameError(null);
          setPickerOpen((open) => !open);
        }}
        picker={
          <GamePicker
            games={games}
            currentGameId={game.manifest.metadata.gameId}
            busy={busy}
            error={gameError}
            onOpen={(gameId) => void openGameById(gameId)}
            onCreate={(name, rulesetId) => void createGame(name, rulesetId)}
            onDelete={(gameId) => void deleteGame(gameId)}
            onExport={(gameId) => void exportGameBackup(gameId)}
            onImport={(file) => void importGameBackup(file)}
            onDismiss={() => setPickerOpen(false)}
          />
        }
        factionLabel={factionLabel}
        turnLabel={turnLabel}
        workingTurnNumber={parsed?.header.turnNumber != null ? comparedTurnChip.working : null}
        turnPickerOpen={turnPickerOpen}
        onToggleTurnPicker={() => void handleOpenTurnPicker()}
        turnPicker={
          parsed?.header.turnNumber != null ? (
            <TurnPicker
              turns={turnSummaries}
              workingTurn={parsed.header.turnNumber}
              comparedTurn={comparison?.key.turnNumber ?? null}
              onSelect={(turnNumber) => void handleSelectComparisonTurn(turnNumber)}
              onDismiss={() => setTurnPickerOpen(false)}
            />
          ) : null
        }
        comparedTurnLabel={comparedTurnChip.compared}
        onStopComparing={() => {
          setComparison(null);
          setTurnPickerOpen(false);
        }}
        mergedCount={mergedReports.length}
        mergedOpen={mergedOpen}
        onToggleMerged={() => setMergedOpen((open) => !open)}
        mergedPanel={
          <MergedFactionsPanel
            turnLabel={turnLabel}
            merged={mergedReports}
            onDismiss={() => setMergedOpen(false)}
          />
        }
        factionOpen={factionOpen}
        onFactionToggle={() => setFactionOpen((open) => !open)}
        factionPanel={
          <FactionPanel
            factionName={parsed?.header.factionName ?? null}
            factionId={parsed?.header.factionId ?? null}
            factionTypes={parsed?.header.factionTypes ?? []}
            unclaimedSilver={parsed?.header.unclaimedSilver ?? null}
            status={parsed?.header.factionStatus ?? null}
            attitudes={parsed?.header.attitudes ?? null}
            mergedFactionIds={new Set(mergedReports.map((record) => record.mergedFactionId))}
            onDismiss={() => setFactionOpen(false)}
          />
        }
        status={status}
        messages={messages}
        messagesOpen={messagesOpen}
        onToggleMessages={() =>
          setMessagesOpen((open) => {
            // Opening lands on the list that has something in it. A turn with no errors would
            // otherwise open onto an empty Errors tab and hide the events behind a second click.
            if (!open) {
              setMessagesTab(messages && messages.errors.length > 0 ? "errors" : "events");
            }
            return !open;
          })
        }
        messagesPanel={
          messages ? (
            <TurnMessagesPanel
              turnLabel={turnLabel}
              errors={messages.errors}
              events={messages.events}
              tab={messagesTab}
              onTab={setMessagesTab}
              knownUnitIds={knownUnitIds}
              onSelectUnit={goToUnit}
              onDismiss={() => setMessagesOpen(false)}
            />
          ) : null
        }
        problemCount={problemsByHex.reduce((count, hex) => count + hex.findings.length, 0)}
        problemsOpen={problemsOpen}
        onToggleProblems={() => setProblemsOpen((open) => !open)}
        problemsPanel={
          <ProblemsPanel
            hexes={problemsByHex}
            labelFor={hexLabel}
            onSelectHex={selectHex}
            onDismiss={() => setProblemsOpen(false)}
          />
        }
        battleCount={parsed?.battles.length ?? 0}
        battlesOpen={battlesOpen}
        onToggleBattles={() =>
          setBattlesOpen((open) => {
            // Opening the chip selects the first battle, so the dialog is never empty - candidate
            // B of docs/ui/battles-view.html, chosen with the navigator.
            if (!open) {
              setSelectedBattleIndex(0);
            }
            return !open;
          })
        }
        changesOpen={changesOpen}
        onToggleChanges={() => setChangesOpen((open) => !open)}
        busy={busy}
        onImportReports={(files) => void importReports(files)}
        progress={importProgress}
        onExportOrders={exportOrders}
        canExport={ordersDocument.length > 0}
        onExportOrdersLong={exportOrdersLong}
        canExportLong={ordersDocument.length > 0 && ordersTemplateText !== null}
        onExportMap={() => openExport()}
        canExportMap={parsed !== null}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        settings={settingsPanel}
      />

      {/*
        In the flow rather than over the map, so the map is pushed down until the question is
        answered. A decision the player has to make should not be dismissible by clicking elsewhere,
        which rules out the popover shape the other header panels use.
      */}
      {pendingLoad ? (
        <ForeignReportPrompt
          fileName={pendingLoad.fileName}
          incomingFactionLabel={pendingLoad.incoming.factionLabel}
          viewerFactionLabel={pendingLoad.viewer.factionLabel}
          incomingTurn={pendingLoad.incoming.turnNumber}
          viewerTurn={pendingLoad.viewer.turnNumber}
          canMerge={pendingLoad.canMerge}
          busy={busy}
          onMerge={mergeReport}
          onSwitch={switchFaction}
          onCancel={() => setPendingLoad(null)}
        />
      ) : null}

      {/*
        The orders-import twin of the prompt above: nothing changes until Replace is pressed, and
        Cancel touches nothing at all.
      */}
      {pendingOrdersImport ? (
        <OrdersImportPrompt
          fileName={pendingOrdersImport.fileName}
          factionLabel={pendingOrdersImport.factionLabel}
          turnNumber={pendingOrdersImport.turnNumber}
          unitCount={pendingOrdersImport.unitCount}
          emptiedCount={pendingOrdersImport.emptiedCount}
          busy={busy}
          onReplace={replaceOrdersImport}
          onCancel={() => setPendingOrdersImport(null)}
        />
      ) : null}

      {/*
        What a batch did, which nothing else on screen can say. A turn that failed to import leaves
        a map indistinguishable from one where the file was never chosen, so this is the only place
        the player finds out - hence a modal rather than the status line the header keeps for the
        single report it was sized for.
      */}
      {importSummary ? (
        <ImportSummaryDialog
          summary={importSummary}
          onDismiss={() => setImportSummary(null)}
        />
      ) : null}

      {/*
        A dirty orders import's diagnostics, listed at once rather than left for the problems chip
        to be opened - the navigator's choice for ah-470, drawn in docs/ui/orders-import.html.
      */}
      {ordersImportSummary ? (
        <OrdersImportSummaryDialog
          summary={ordersImportSummary}
          onDismiss={() => setOrdersImportSummary(null)}
        />
      ) : null}

      {/*
        The one question a batch asks. Raised before anything is written, so cancelling costs the
        player nothing but the reading.
      */}
      {pendingBatch ? (
        <ViewerFactionPrompt
          options={pendingBatch.options}
          onChoose={(factionId) => {
            const held = pendingBatch;
            setPendingBatch(null);
            void runBatch(held.batch, factionId);
          }}
          onCancel={() => setPendingBatch(null)}
        />
      ) : null}

      <div className="relative min-h-0 flex-1">
        <MapCanvas
          gameId={game?.manifest.metadata.gameId ?? null}
          model={model}
          theme={getMapTheme(mapThemeId)}
          level={level}
          selectedRegionId={selectedRegionId}
          selectionEpoch={selectionEpoch}
          onSelectRegion={selectHex}
          showStaleness={layers.staleness}
          showTextures={showTextures}
          badges={badges}
          route={chooseRouteOverlay({
            movementLayerOn: layers.movement,
            plannerArmed: planner.armed,
            plan: route?.plan ?? null,
            trace: orderTrace?.path ?? null
          })}
          routeRisk={layers.movement && route?.plan ? (route.risk?.hexes ?? []) : []}
          // Gated on a report for the same reason the header button and the palette entry are:
          // there is nothing to export a map of until one is loaded, and a dialog that opened
          // anyway could only refuse.
          onMarquee={parsed ? (rect) => openExport(rect) : undefined}
        />

        {/*
          `data-map-overlay` on each pane tells the map which of its edges is covered, so framing
          fits the world into the strip the player can actually see rather than centring it under
          a panel. The chips row is marked rather than the strip that holds it: an unmarked
          full-width wrapper would read as covering the map from left to right.
        */}
        <div className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-center">
          <div data-map-overlay="top">
            <LayerChips levels={model.levels} />
          </div>
        </div>

        {/*
          Region left, unit and orders right, units along the bottom.

          Laid out as a column rather than by absolute offsets: the unit dock sits on the floor and
          grows upward as a hex holds more units, and the row above yields the space. Pinning the
          dock's height instead would either waste the screen on an empty hex or bury ninety units
          in a scroller.

          Nothing here takes clicks. Each panel claims its own (see `CollapsiblePanel`), so the
          gaps between them, and everything a folded panel gives up, stays live map rather than a
          transparent slab that swallows every hex under it.

          A folded panel's slot shrinks to its title bar and the space goes to the panel beside it -
          fold the unit panel and the orders editor takes the column. `panelLayout` decides which
          slot is the flexible one; only this file knows what sits next to what.
        */}
        <div className="pointer-events-none absolute inset-0 flex flex-col gap-2.5 p-2.5 pt-12">
          <div className="flex min-h-0 flex-1 justify-between gap-2.5">
            <div className="flex w-[19rem] min-h-0 flex-col" data-map-overlay="left">
              <RegionPanel
                hex={hex}
                unknown={unknownHex}
                problems={findingsForHex(validated.diagnostics, hex?.regionId ?? null)}
              />
            </div>

            <div className="flex w-[21rem] min-h-0 flex-col gap-2.5" data-map-overlay="right">
              <div className={unitSlotClass(collapsed)}>
                <UnitPanel unit={unit} hex={hex} preview={unitPreview} />
              </div>
              {/* Behind its feature flag, off by default: the pane is still finding its shape. */}
              {movementPlanner ? (
                <div className="flex-none">
                  <PlannerPanel
                    unit={unit}
                    armed={planner.armed}
                    busy={planning}
                    answer={route}
                    onArm={armPlanner}
                    onClear={() => {
                      clearPlan();
                      setRoute(null);
                    }}
                    onApply={applyRoute}
                  />
                </div>
              ) : null}
              {!collapsed.unit && !collapsed.orders ? (
                <PanelSplitter
                  ordersSlot={ordersSlotRef}
                  ordersHeightRem={ordersHeightRem}
                  onCommit={setOrdersHeight}
                />
              ) : null}
              <div
                ref={ordersSlotRef}
                className={ordersSlotClass(collapsed, ordersHeightRem != null)}
                style={ordersSlotStyle(collapsed, ordersHeightRem) ?? undefined}
              >
                <OrdersPanel
                  unit={unit}
                  hex={hex}
                  document={ordersDocument}
                  ownFactionName={factionLabel ?? "your faction"}
                  onChange={onOrdersChange}
                  validated={validated}
                  save={save}
                  commands={orderCommands}
                  snippets={snippets}
                  editorRef={ordersEditor}
                />
              </div>
            </div>
          </div>

          <div className="max-h-[45vh] flex-none" data-map-overlay="bottom">
            <UnitTableDock hex={hex} preview={hexPreview} />
          </div>
        </div>
      </div>
      {exportOpen ? (
        <MapExportDialog
          hexes={model.hexes}
          level={level}
          selection={exportRect}
          busy={exportBusy}
          error={exportError}
          onExport={(rect, content) => void exportMap(rect, content)}
          onDismiss={() => setExportOpen(false)}
        />
      ) : null}
      {battlesOpen && parsed && parsed.battles.length > 0 ? (
        <BattlesDialog
          battles={parsed.battles}
          selectedIndex={selectedBattleIndex}
          onSelect={setSelectedBattleIndex}
          hexLabel={hexLabel}
          viewerFactionId={parsed.header.factionId}
          onShowOnMap={(regionId) => {
            selectHex(regionId);
            setBattlesOpen(false);
          }}
          onDismiss={() => setBattlesOpen(false)}
        />
      ) : null}
      {changesOpen && turnDiff ? (
        <ChangesDialog
          pairLabel={`turn ${turnDiff.olderTurn} → ${turnDiff.newerTurn}`}
          tab={changesTab}
          onTab={setChangesTab}
          tabs={changesTabsList}
          unitRows={changesUnitRows}
          unitsEmptyText={unitsEmptyText()}
          regionRows={changesRegionRows}
          regionsEmptyText={regionsEmptyText()}
          orderRows={changesOrderRows}
          ordersEmptyText={
            comparedOrdersLoading
              ? "Loading orders…"
              : ordersEmptyText(ordersDiff, comparison?.key.turnNumber ?? turnDiff.newerTurn)
          }
          onSelectUnit={handleSelectChangedUnit}
          onSelectRegion={handleSelectChangedRegion}
          onDismiss={() => setChangesOpen(false)}
        />
      ) : null}
      {keyboardPanels}
    </div>
  );
}

/** Exposed for tests and for panels that need to read a unit's slice without the shell. */
export { readUnitOrders };
