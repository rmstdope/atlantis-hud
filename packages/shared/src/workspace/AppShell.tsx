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
import { ADVISORY_CHECK_CODES } from "@atlantis/core-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildHexMapModel,
  parseRegionId,
  unitsForHex,
  type HexMapModel
} from "../hexMapModel";
import { type TextFileSaver } from "../downloadFile";
import { readUnitOrders, stripMovementOrderLines, writeUnitOrders } from "../ordersDocument";
import { isOrdersFile, routeOrdersImport, type PendingOrdersImport } from "../ordersImport";
import { deliverGameBackupExport, deliverMapExport, deliverOrdersExport } from "./exportActions";
import {
  mergeTurn,
  readMemory,
  restoreLatestTurn,
  toStoredRegions,
  type MemoryOutcome
} from "../gameMemory";
import { isOlderTurn } from "../reportLoadDecision";
import {
  factionLabelOf,
  loadTurn,
  openingSelection,
  reportParser,
  routeReport,
  storeOlderTurn,
  type LoadedTurn,
  type PendingReportLoad
} from "../reportLoad";
import { chooseViewerFaction } from "../reportBatch";
import {
  batchSummary,
  prepareBatch,
  viewerFactionOptions,
  walkBatch,
  type PreparedBatch
} from "../batchImport";
import type { ImportSummary } from "../importSummary";
import { describeMerge } from "../foreignReport";
import {
  AUTOSAVE_CEILING_MS,
  AUTOSAVE_IDLE_MS,
  createDraftWriter,
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
import { openNewestGame, rulesetUrlFor } from "../gameSession";
import {
  changeRuleset as changeRulesetAction,
  createGame as createGameAction,
  deleteGame as deleteGameAction,
  importGameBackup as importGameBackupAction,
  importGameBackupAsCopy,
  openGame as openGameAction,
  renameGame as renameGameAction,
  replaceGameWithBackup,
  type GameActionOutcome
} from "../gameActions";
import type { BackupImportMode } from "../gameBackup";
import { DEFAULT_LEVEL, useWorkspaceStore } from "../workspaceStore";
import { useHexNotesStore } from "../hexNotesStore";
import { useSettingsStore } from "../settingsStore";
import { AppHeader, type ImportStatus } from "./AppHeader";
import { TurnPicker } from "./TurnPicker";
import { comparisonChipLabel, type ComparisonTurn } from "../turnCompare";
import { listComparableTurns, pickComparisonTurn } from "../comparisonActions";
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
import { loadSavedView, saveMapView } from "./mapViewportStorage";
import type { MapViewState } from "./mapViewState";
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
import {
  dragOrdersHeight,
  dragUnitsHeight,
  ordersSlotClass,
  ordersSlotStyle,
  ORDERS_DEFAULT_REM,
  ORDERS_MAX_REM,
  ORDERS_MIN_REM,
  RAIL_LEFT_DEFAULT_REM,
  RAIL_RIGHT_DEFAULT_REM,
  railWidthStyle,
  unitSlotClass,
  unitsSlotClass,
  unitsSlotStyle,
  UNITS_DEFAULT_REM,
  UNITS_MAX_REM,
  UNITS_MIN_REM
} from "./panelLayout";
import { PanelSplitter } from "./PanelSplitter";
import { RailSplitter } from "./RailSplitter";
import { PlannerPanel } from "./PlannerPanel";
import { chooseRouteOverlay } from "./routeOverlay";
import { RegionPanel } from "./RegionPanel";
import { ProblemsPanel } from "./ProblemsPanel";
import { TurnMessagesPanel, type TurnMessagesTab } from "./TurnMessagesPanel";
import { UnitPanel } from "./UnitPanel";
import { UnitTableDock } from "./UnitTableDock";
import { describeError, runReported } from "./shellAction";
import { failedStatus, warningStatus } from "./shellStatus";

/**
 * Re-exported rather than defined here since issue #53 moved the rule into `reportLoadDecision`.
 *
 * It is now one branch of a larger decision, and it sits beside the others in a plain module that
 * can be tested without rendering anything.
 */
export { isOlderTurn };

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
   * How this shell puts a file where the player asks.
   *
   * Injected for the same reason `registerBeforeQuit` is, and required (ah-150): the fork between
   * "ask with a dialog" and "hand it to the browser" used to be an optional prop each exporter had
   * to remember to route through, and the same defect - a desktop export landing wherever the
   * webview put it, no dialog, no path - was fixed three times before this port stopped being
   * optional. The web shell passes `browserTextFileSaver`; the desktop shell asks and can say where
   * the file went.
   */
  saveTextFile: TextFileSaver;
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
  // Bumped by `enterGame` alone - open, create and every import mode, replace included. What the
  // ruleset-fetch, turn-restore and hex-notes effects below actually need to know is "did the
  // player just land in a (possibly different) database", not "did `game`'s reference change":
  // `changeRuleset` and `renameGame` both call `setGame` directly, without going through
  // `enterGame`, and only `changeRuleset`'s ruleset id actually moving is a reason for those
  // effects to redo their work - a rename is not. A `replace` import is the case object identity
  // alone cannot distinguish from a rename: it keeps the same game id yet swaps out everything
  // the id points at, which is exactly why this is a counter rather than a derived boolean.
  const [gameEpoch, setGameEpoch] = useState(0);
  const [games, setGames] = useState<GameManifest[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  // The map's note pins (ah-o1t.3); the panel reads the same store directly.
  const hexNotes = useHexNotesStore((state) => state.notes);
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
  const unitsSlotRef = useRef<HTMLDivElement | null>(null);
  const leftRailRef = useRef<HTMLDivElement | null>(null);
  const rightRailRef = useRef<HTMLDivElement | null>(null);
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
  const selectUnit = useWorkspaceStore((state) => state.selectUnit);
  const level = useWorkspaceStore((state) => state.level);
  const setLevel = useWorkspaceStore((state) => state.setLevel);
  const layers = useWorkspaceStore((state) => state.layers);
  const badges = useWorkspaceStore((state) => state.badges);
  const showTextures = useSettingsStore((state) => state.biomeTextures);
  const mapThemeId = useSettingsStore((state) => state.mapTheme);
  const advisoryChecks = useSettingsStore((state) => state.advisoryChecks);
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
  // The units-in-hex pane's own dragged height, exactly the same preference shape - ah-2r3.
  const unitsHeightRem = useWorkspaceStore((state) => state.unitsHeightRem);
  const setUnitsHeight = useWorkspaceStore((state) => state.setUnitsHeight);
  // The player's own widths for the two rails floating over the map, dragged at the grip on each
  // one's inner edge; null means the default width from `panelLayout.ts` still applies.
  const leftRailWidthRem = useWorkspaceStore((state) => state.leftRailWidthRem);
  const rightRailWidthRem = useWorkspaceStore((state) => state.rightRailWidthRem);
  const setRailWidth = useWorkspaceStore((state) => state.setRailWidth);
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
  const updateGameNameInStore = useWorkspaceStore((state) => state.updateGameName);

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

  // Writes the whole map view whenever any part of it changes - level, hex or the map's own pan
  // and zoom, all held in one place by the store's `mapView` slice now (ah-ian). Guarded on a
  // committed viewport: before the map has framed anything for this game there is nothing to
  // write yet, and writing `{level, regionId}` alone would make a reload fit instead of restore.
  //
  // Read via `subscribe` rather than the usual `useWorkspaceStore(state => state.mapView)`
  // selector: `mapView` changes on every pan, zoom and wheel step, and a shell this size
  // re-rendering on each of those would cost far more than the write itself does. `level` and
  // `selectedRegionId` are already subscribed above for the UI they drive, so this effect still
  // sees their latest values through the closure; only the write's own trigger - `mapView`
  // changing - is kept out of the render loop.
  useEffect(() => {
    if (openGameId === null) {
      return undefined;
    }
    const write = (current: MapViewState) => {
      if (current.gameId !== openGameId || current.viewport === null) {
        return;
      }
      saveMapView(openGameId, { viewport: current.viewport, level, regionId: selectedRegionId });
    };
    write(useWorkspaceStore.getState().mapView);
    return useWorkspaceStore.subscribe((state, previous) => {
      if (state.mapView !== previous.mapView) {
        write(state.mapView);
      }
    });
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
          : []),
        // Only with a game open and a hex selected: a note needs both to be saved anywhere - ah-o1t.
        ...(game && selectedRegionId
          ? [
              {
                id: "add-hex-note",
                label: "Add note to this hex",
                run: () => {
                  if (useWorkspaceStore.getState().collapsed.region) {
                    useWorkspaceStore.getState().togglePanel("region");
                  }
                  useHexNotesStore.getState().requestAddFor(selectedRegionId);
                }
              }
            ]
          : [])
      ],
      orderCommands,
      insertOrder: (command) => ordersEditor.current?.insertOrder(command)
    });
  }, [
    orderedOwnUnitIds,
    parsed,
    model,
    goToUnit,
    selectHex,
    setTheme,
    theme,
    orderCommands,
    game,
    selectedRegionId
  ]);

  /**
   * Puts a loaded turn on screen - the only place a turn is applied, whichever way it arrived.
   *
   * The restore effect below is the one other place a turn reaches the screen, and it is not routed
   * through this: it applies a `RestoredTurn`, which has no `status` counts of its own, and it is an
   * effect with cancellation this function has no business being wired into.
   */
  const applyLoadedTurn = useCallback(
    (loaded: LoadedTurn) => {
      setParsed(loaded.parsed);
      setRawReport(loaded.rawReport);
      clearPlan();
      setRoute(null);
      // A new working turn redefines the pair: a comparison held against the turn just replaced
      // would go on claiming a relationship to a turn no longer on screen.
      setComparison(null);
      setTurnPickerOpen(false);
      setRemembered(loaded.remembered);
      // Reset from the turn just loaded, never merely added to: a merge belongs to the turn it
      // was made in, so turn 71's allies must not still be claimed on turn 72's map.
      setMergedReports(loaded.merged);
      setOrdersDocument(loaded.orders);
      setSave(savedStateFor(loaded.ordersSavedAt));
      setStatus(loaded.status);

      // Opening on a hex the player has units in beats opening on whatever came first, and the unit
      // inside it is chosen for the same reason.
      //
      // Only when nothing is selected, which is the same guard the restore path makes: a turn
      // landing in a game already being worked in is not a reason to move the player. It used to
      // move them, and the map travelled to the new selection, so an import threw away whatever
      // corner of the map they had just navigated to.
      if (useWorkspaceStore.getState().selectedRegionId === null) {
        const opening = openingSelection(loaded.parsed);
        if (opening) {
          selectRegion(opening.regionId, opening.unitId);
        }
      }
    },
    [clearPlan, selectRegion]
  );

  /**
   * Puts a parsed report on screen and files it in the game.
   *
   * Split out of `loadReport` so that the direct path and the path through the foreign-report
   * prompt run identical code: a report the player reached by pressing "Switch faction" must land
   * exactly as one they simply opened. Deliberately does not depend on `parsed` - only the routing
   * above needs to know what is already loaded, and putting it here would rebuild this callback
   * every time a report is opened.
   *
   * Nothing is shown until `loadTurn` has read everything - the commit, the remembered map, the
   * saved orders - so a failure here leaves the *previous* turn on screen instead of a report set
   * over an empty map (2026-08-15, ah-k6i.5).
   */
  const applyReport = useCallback(
    (
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
    ) =>
      runReported(
        () => loadTurn(client, game, report, text, rulesetText, new Date().toISOString(), committed),
        (message) => setStatus(failedStatus(message)),
        { prefix: `could not read ${fileName}` }
      ).then((loaded) => {
        if (loaded) {
          applyLoadedTurn(loaded);
        }
      }),
    [client, game, rulesetText, applyLoadedTurn]
  );

  /**
   * Commits an older report to the game's stored turn history, and leaves the screen untouched.
   *
   * gh-208: an older report - own or foreign - must never become the working turn, but it is still
   * committed so the turn-comparison feature (ah-jg6.3/4) can read it later. Never touches
   * `setParsed`, `setRawReport`, `setOrdersDocument`, `setSave`, `clearPlan`, `setRoute`,
   * `setComparison`, `setTurnPickerOpen` or `selectRegion` - the turn on screen has not changed.
   * Its own rejection is reported by the enclosing `loadReport`, with the file name.
   */
  const storeReportOnly = useCallback(
    async (report: ParsedReport, text: string, currentTurn: number) => {
      if (!game) {
        // Should not be reachable - a report cannot be imported at all without an open game - but
        // claiming success here would tell the player a turn is stored when nothing was written.
        setStatus(failedStatus("there is no open game to store it in"));
        return;
      }
      setStatus(await storeOlderTurn(client, game, report, text, rulesetText, new Date().toISOString(), currentTurn));
    },
    [client, game, rulesetText]
  );

  const loadReport = useCallback(
    (text: string, fileName: string) =>
      runReported(
        async () => {
          // Whatever was being written belongs to the turn that is about to be replaced. Saved
          // before anything else, because the state below is what tells the flush which draft it is.
          await flush();

          // Classified when the ruleset is to hand, so a unit's men are counted rather than guessed.
          // Without it every unit reads as an estimate, including the single-race majority where the
          // leading-group figure is exactly right.
          const report = await reportParser(client, ruleset)(text);

          const route = routeReport(parsed, report, text, fileName);

          if (route.kind === "ask") {
            // The question is asked and the load stops here. `busy` is released by `runReported`'s
            // `finally`, because it disables the button that opened this file and a prompt the
            // player cannot answer would be worse than no prompt. A second file dropped while this
            // is up simply replaces the question rather than queueing behind it.
            setPendingOrdersImport(null);
            setPendingLoad(route.pending);
            return;
          }

          if (route.kind === "storeOnly") {
            await storeReportOnly(report, text, route.currentTurn);
            return;
          }

          await applyReport(report, text, fileName);
        },
        (message) => setStatus(failedStatus(message)),
        { busy: setBusy, prefix: `could not read ${fileName}` }
      ),
    // `ruleset` belongs here: without it the callback closes over the value at first render, which
    // is null, and every report is parsed unclassified however long the ruleset took to arrive.
    // `parsed` because the routing above is decided against whatever is on screen.
    [client, ruleset, parsed, applyReport, storeReportOnly]
  );

  /** Opens the pending report as its own faction: today's behaviour, chosen rather than assumed. */
  const switchFaction = useCallback(() => {
    const pending = pendingLoad;
    if (!pending) {
      return;
    }
    setPendingLoad(null);
    void runReported(
      () => applyReport(pending.report, pending.text, pending.fileName),
      (message) => setStatus(failedStatus(message)),
      { busy: setBusy }
    );
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
    void runReported(
      async () => {
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
      },
      (message) => setStatus(failedStatus(message)),
      { busy: setBusy, prefix: `could not merge ${pending.fileName}` }
    );
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
      const route = routeOrdersImport({ game, parsed }, text, fileName, ordersDocument);
      if (route.kind === "refuse") {
        setStatus(failedStatus(route.message));
        return;
      }
      // The one question a file drop can raise, whichever kind of file it turns out to be - this
      // one replaces a foreign-report question left open exactly as a second report replaces it.
      setPendingLoad(null);
      setPendingOrdersImport(route.pending);
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
    (batch: PreparedBatch, viewerFactionId: string | null) =>
      runReported(
        async () => {
          if (!game) {
            // Unreachable - a batch cannot be prepared without an open game.
            return;
          }

          const walk = await walkBatch(
            client,
            game,
            batch,
            viewerFactionId,
            parsed?.header.turnNumber ?? null,
            rulesetText,
            () => new Date().toISOString(),
            (done, total) => setImportProgress({ done, total })
          );

          if (walk.finish) {
            // What ends up on screen: the batch's newest own turn, applied the way a single report
            // is so that the orders, the selection and the map all land identically. Read back
            // rather than committed again - the walk has already written this turn and the allies
            // of it, and a second commit would rewrite the turn's sightings from this report alone,
            // dropping every ally contribution to a hex the viewer also stood in. A landed import
            // step is proof `viewerFactionId` was not null (`walkBatch`'s note on why).
            const memory = await readMemory(
              client,
              game,
              viewerFactionId as string,
              walk.finish.step.turnNumber
            );
            await applyReport(
              walk.finish.source.report,
              walk.finish.source.text,
              walk.finish.step.fileName,
              memory
            );
          } else if (viewerFactionId) {
            // Nothing of the viewer's own landed, so the turn on screen has not changed - only the
            // map under it, which the merges have grown. Nothing to read back at all when the batch
            // never had a faction to act under - every file is already accounted for in the summary.
            const memory = await readMemory(client, game, viewerFactionId, parsed?.header.turnNumber ?? null);
            setRemembered(memory.remembered);
            setMergedReports(memory.merged);
          }

          setImportSummary(batchSummary(walk, walk.finish?.source.report ?? parsed));
        },
        (message) => setStatus(failedStatus(message)),
        {
          busy: (busy) => {
            setBusy(busy);
            if (!busy) {
              setImportProgress(null);
            }
          }
        }
      ),
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
          setStatus(failedStatus(`could not read ${only.name}: ${describeError(error)}`));
        }
        return;
      }

      setImportProgress({ done: 0, total: files.length });
      // Whatever was being written belongs to the turn that is about to be replaced. Saved first,
      // exactly as a single report saves it. Reaching the `catch` below means the draft could not
      // be saved, not that a report would not parse - an unreadable file is caught per file inside
      // `prepareBatch`. Nothing has been written then, and the batch is abandoned rather than run:
      // whatever the player was writing is still only in the editor.
      const batch = await runReported(
        async () => {
          await flush();
          return prepareBatch(files, reportParser(client, ruleset));
        },
        (message) => setStatus(failedStatus(message)),
        {
          busy: (busy) => {
            setBusy(busy);
            if (!busy) {
              setImportProgress(null);
            }
          },
          prefix: "could not start the import"
        }
      );
      if (!batch) {
        return;
      }

      const choice = chooseViewerFaction(parsed?.header.factionId ?? null, batch.candidates);
      if (choice.kind === "ask") {
        // Held rather than run. Nothing has been written yet, so cancelling costs the player only
        // the reading - and the files are kept parsed so answering does not re-read them.
        setPendingBatch({ batch, options: viewerFactionOptions(batch, choice.factionIds) });
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
  //
  // Keyed on the game and ruleset ids, plus `gameEpoch`, rather than on `game` itself (ah-lkw): a
  // rename hands the shell a fresh `game` object too, and keying on identity alone would refetch
  // and flash "loading" for a change the ruleset file has nothing to do with. `gameEpoch` is what
  // still catches a `replace` import, which keeps the same game id and may keep the same ruleset
  // id while swapping out everything else - see the epoch's own comment by its `useState`.
  useEffect(() => {
    if (!game) {
      setRuleset({ status: "unavailable" });
      return undefined;
    }
    const rulesetId = game.manifest.metadata.rulesetId;

    let cancelled = false;
    setRuleset({ status: "loading" });
    void Promise.resolve()
      .then(() => fetch(rulesetUrlFor(rulesetId)))
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
  }, [openGameId, game?.manifest.metadata.rulesetId, gameEpoch]);

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
   * Keeps the hex notes store in step with the open game (ah-o1t): loads its notes when a game
   * opens, clears them when it closes. Its own effect rather than folded into the restore effect
   * below - notes do not depend on the ruleset.
   *
   * Keyed on `openGameId` and `gameEpoch` rather than on `game` itself (ah-lkw): a rename hands
   * the shell a fresh `game` object too, and the notes for a game do not change just because its
   * name did. `gameEpoch` still catches a `replace` import, which swaps out the notes along with
   * everything else under the same game id.
   */
  useEffect(() => {
    if (game) {
      void useHexNotesStore.getState().load(client, game);
    } else {
      useHexNotesStore.getState().clear();
    }
  }, [client, openGameId, gameEpoch]);

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
   * player then opens a report of their own. Keyed on `openGameId` and `gameEpoch` rather than on
   * `game` itself (ah-lkw): a rename hands the shell a fresh `game` object too, and neither the id
   * nor the database path `restoreLatestTurn` reads off it change because the name did -
   * re-parsing the turn (and the `busy` flip around it, which blurs whatever control has focus)
   * would be pure churn. `gameEpoch` still catches a `replace` import under the same game id.
   */
  useEffect(() => {
    if (!game || ruleset.status === "loading") {
      return undefined;
    }

    let cancelled = false;
    setBusy(true);

    void restoreLatestTurn(client, game, reportParser(client, ruleset))
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
          setStatus(failedStatus(`the last turn could not be restored: ${describeError(error)}`));
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
  }, [client, openGameId, ruleset, selectRegion, selectUnit, gameEpoch]);

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
      setGameEpoch((epoch) => epoch + 1);
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
      // The game, the level, the selected hex and the pending viewport all land in one `set` -
      // `openGame` reads the saved record itself, so no render sees a new game over an old view or
      // the reverse (ah-ian). The level is set whether or not one was saved: it is the only part
      // of the view the store keeps across a game switch, so a game with nothing saved would
      // otherwise open on whichever level the game before it was left on.
      openGameInStore(
        {
          gameId: opened.manifest.metadata.gameId,
          gameName: opened.manifest.metadata.gameName,
          databasePath: opened.databasePath,
          rulesetId: opened.manifest.metadata.rulesetId
        },
        loadSavedView(opened.manifest.metadata.gameId)
      );
    },
    [clearPlan, openGameInStore]
  );

  /**
   * Every game action runs through here: clears the last error, holds `busy`, reports a failure.
   * Generic so a caller can learn whether its work finished - `renameGame` below needs that to
   * decide whether to close its own edit field.
   */
  const runGameAction = useCallback(
    <T,>(work: () => Promise<T>, prefix?: string) => {
      setGameError(null);
      return runReported(work, setGameError, { busy: setBusy, prefix });
    },
    []
  );

  const openGameById = useCallback(
    (gameId: string) =>
      runGameAction(async () => {
        // Before the workspace lets go of the old game. `enterGame` wipes the document, and
        // whatever was in it belongs to a game the player is walking away from.
        await flush();
        const outcome = await openGameAction(client, gameId, new Date().toISOString());
        enterGame(outcome.opened);
        setGames(outcome.games);
        setPickerOpen(false);
      }),
    [client, enterGame, flush, runGameAction]
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
    (rulesetId: string) => {
      if (!game) {
        return;
      }
      return runGameAction(async () => {
        // The re-restore below re-reads orders from the database, so the draft must be there first.
        await flush();
        const result = await changeRulesetAction(client, game, rulesetId);
        if (!result) {
          return;
        }
        setGame({ ...game, manifest: result.manifest });
        updateGameRulesetInStore(rulesetId);
        setGames(result.games);
      });
    },
    [client, game, flush, runGameAction, updateGameRulesetInStore]
  );

  /**
   * Renames the open game. Resolves `true` when the name was saved, `false` when the core refused
   * (the reason is in `gameError`) - the field's own save button reads this to decide whether to
   * close.
   */
  const renameGame = useCallback(
    async (gameName: string): Promise<boolean> => {
      if (!game) {
        return false;
      }
      const done = await runGameAction(async () => {
        // The rename writes the manifest to the same database a pending draft write may still be
        // headed for; flushing first keeps the two from racing, the same as every other action
        // here that touches the game's storage.
        await flush();
        const result = await renameGameAction(client, game, gameName);
        setGame({ ...game, manifest: result.manifest });
        updateGameNameInStore(result.manifest.metadata.gameName);
        setGames(result.games);
        return true;
      });
      return done === true;
    },
    [client, game, flush, runGameAction, updateGameNameInStore]
  );

  const createGame = useCallback(
    (name: string, rulesetId: string) =>
      runGameAction(async () => {
        await flush();
        const now = new Date().toISOString();
        const outcome = await createGameAction(client, name, rulesetId, now);
        enterGame(outcome.opened);
        setGames(outcome.games);
        setPickerOpen(false);
      }),
    [client, enterGame, flush, runGameAction]
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
    (gameId: string) =>
      runGameAction(async () => {
        const result = await deleteGameAction(
          client,
          gameId,
          game?.manifest.metadata.gameId ?? null,
          new Date().toISOString(),
          () => writer.discard()
        );
        setGames(result.games);
        if (result.closedOpenGame) {
          if (result.opened) {
            enterGame(result.opened);
          } else {
            setGame(null);
            closeGameInStore();
          }
        }
        setPickerOpen(false);
      }),
    [client, closeGameInStore, enterGame, game, runGameAction, writer]
  );

  const exportGameBackup = useCallback(
    (gameId: string) =>
      runGameAction(async () => {
        await flush();
        const backup = await client.exportGame(gameId, new Date().toISOString());
        const gameName = games.find((g) => g.metadata.gameId === gameId)?.metadata.gameName ?? gameId;
        const path = await deliverGameBackupExport(saveTextFile, gameName, backup);
        if (path === null) {
          // The player cancelled the native save. Nothing was written, so the picker stays open
          // rather than claiming an export that never happened.
          return;
        }
        setPickerOpen(false);
      }),
    [client, flush, games, runGameAction, saveTextFile]
  );

  const importGameBackup = useCallback(
    (file: File, mode: BackupImportMode = "new") =>
      runGameAction(async () => {
        const backupJson = await file.text();
        const now = new Date().toISOString();
        let outcome: GameActionOutcome & { opened: OpenedGame };
        if (mode === "replace") {
          outcome = await replaceGameWithBackup(client, backupJson, game?.manifest.metadata.gameId ?? null, now, {
            flush,
            discardOpenDraft: () => writer.discard()
          });
        } else {
          // Before the workspace lets go of the old game (see openGameById).
          await flush();
          outcome =
            mode === "copy"
              ? await importGameBackupAsCopy(client, backupJson, now)
              : await importGameBackupAction(client, backupJson, now);
        }
        enterGame(outcome.opened);
        setGames(outcome.games);
        setPickerOpen(false);
        setSettingsOpen(false);
      }, `could not import ${file.name}`),
    [client, enterGame, flush, game, runGameAction, writer]
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
          setStatus(failedStatus(`could not plan a route: ${describeError(error)}`));
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
          disabledCodes: ADVISORY_CHECK_CODES.filter((code) => !advisoryChecks[code])
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
  }, [client, ordersDocument, rulesetText, rawReport, advisoryChecks]);

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
      setStatus(
        failedStatus(
          `could not import ${pending.fileName}: the open turn changed before Replace was pressed`
        )
      );
      return;
    }

    void runReported(
      async () => {
        setOrdersDocument(pending.text);
        writer.markDirty(game, draftKey, pending.text);

        const result = await client.validateOrders(pending.text, rulesetText, rawReport || null, {
          disabledCodes: ADVISORY_CHECK_CODES.filter((code) => !advisoryChecks[code])
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
      },
      (message) => setStatus(failedStatus(message)),
      { busy: setBusy, prefix: `could not import ${pending.fileName}` }
    );
  }, [
    pendingOrdersImport,
    client,
    game,
    parsed,
    draftKey,
    writer,
    rulesetText,
    rawReport,
    advisoryChecks
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
      setExportError(null);
      await runReported(
        async () => {
          // A shell that can put the file where the player asks does, and the player picked the
          // place, so nothing needs to tell them afterwards where it went. The browser gets the
          // download it is capable of. A cancelled save dialog leaves the export dialog standing:
          // nothing was written, and closing it would look as though something had been.
          const path = await deliverMapExport(
            client,
            saveTextFile,
            rawReport,
            rememberedJson,
            level,
            parsed?.header.turnNumber ?? null,
            rect,
            content
          );
          if (path === null) {
            return;
          }
          setExportOpen(false);
        },
        setExportError,
        { busy: setExportBusy }
      );
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
   *
   * A listing that fails closes the picker and warns, because an open picker over a stale list
   * would claim turns that may be gone (ah-k6i.1).
   */
  const handleOpenTurnPicker = useCallback(async () => {
    const opening = !turnPickerOpen;
    setTurnPickerOpen(opening);
    if (!opening || !game || !parsed?.header.factionId) {
      return;
    }
    const gameId = game.manifest.metadata.gameId;
    const factionId = parsed.header.factionId;
    const summaries = await runReported(
      () => listComparableTurns(client, game.databasePath, gameId, factionId),
      (message) => {
        // Nothing to pick from, so nothing to show: same exit as a comparison that would not load.
        setStatus(warningStatus(message));
        setTurnPickerOpen(false);
      },
      { prefix: "could not list the turns to compare" }
    );
    if (summaries !== undefined) {
      setTurnSummaries(summaries);
    }
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
      const workingTurn = parsed?.header.turnNumber ?? null;
      const reportComparisonFailure = (message: string) => {
        setStatus(warningStatus(message));
        setTurnPickerOpen(false);
      };
      const factionId = parsed?.header.factionId;
      if (workingTurn === null || !game || !factionId) {
        reportComparisonFailure(`could not load turn ${clickedTurn} for comparison`);
        return;
      }
      const parse = (text: string) =>
        ruleset.status === "ready"
          ? client.parseReportClassified(text, ruleset.text)
          : client.parseReportFull(text);
      await runReported(
        async () => {
          const pick = await pickComparisonTurn(
            client,
            {
              databasePath: game.databasePath,
              gameId: game.manifest.metadata.gameId,
              factionId,
              workingTurn,
              currentTurn: comparison?.key.turnNumber ?? null,
              parse
            },
            clickedTurn
          );
          if (pick.changed) {
            setComparison(pick.comparison);
          }
          setTurnPickerOpen(false);
        },
        reportComparisonFailure,
        { prefix: `could not load turn ${clickedTurn} for comparison` }
      );
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
            onImport={(file, mode) => void importGameBackup(file, mode)}
            onRename={renameGame}
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
          notes={hexNotes}
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

          Laid out as a column rather than by absolute offsets. The units pane stands at its own
          dragged height (default twelve rows), exactly like the orders editor - ah-2r3 - so moving
          between hexes never resizes it; a short list simply leaves blank pane below.

          Nothing here takes clicks. Each panel claims its own (see `CollapsiblePanel`), so the
          gaps between them, and everything a folded panel gives up, stays live map rather than a
          transparent slab that swallows every hex under it.

          A folded panel's slot shrinks to its title bar and the space goes to the panel beside it -
          fold the unit panel and the orders editor takes the column. `panelLayout` decides which
          slot is the flexible one; only this file knows what sits next to what.
        */}
        <div className="pointer-events-none absolute inset-0 flex flex-col gap-2.5 p-2.5 pt-12">
          <div className="flex min-h-0 flex-1 justify-between gap-2.5">
            <div
              ref={leftRailRef}
              className="relative flex min-h-0 flex-col"
              style={railWidthStyle(leftRailWidthRem ?? RAIL_LEFT_DEFAULT_REM) ?? undefined}
              data-map-overlay="left"
            >
              <RegionPanel
                hex={hex}
                unknown={unknownHex}
                problems={findingsForHex(validated.diagnostics, hex?.regionId ?? null)}
                client={client}
                game={game}
                turn={parsed?.header.turnNumber ?? null}
              />
              <RailSplitter
                side="left"
                rail={leftRailRef}
                widthRem={leftRailWidthRem}
                defaultRem={RAIL_LEFT_DEFAULT_REM}
                label="Resize region panel"
                onCommit={(rem) => setRailWidth("left", rem)}
              />
            </div>

            <div
              ref={rightRailRef}
              className="relative flex min-h-0 flex-col gap-2.5"
              style={railWidthStyle(rightRailWidthRem ?? RAIL_RIGHT_DEFAULT_REM) ?? undefined}
              data-map-overlay="right"
            >
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
                  slot={ordersSlotRef}
                  heightRem={ordersHeightRem}
                  defaultRem={ORDERS_DEFAULT_REM}
                  minRem={ORDERS_MIN_REM}
                  maxRem={ORDERS_MAX_REM}
                  drag={dragOrdersHeight}
                  label="Resize orders panel"
                  testId="panel-splitter"
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
              <RailSplitter
                side="right"
                rail={rightRailRef}
                widthRem={rightRailWidthRem}
                defaultRem={RAIL_RIGHT_DEFAULT_REM}
                label="Resize unit and orders panels"
                onCommit={(rem) => setRailWidth("right", rem)}
              />
            </div>
          </div>

          {!collapsed.units ? (
            <PanelSplitter
              slot={unitsSlotRef}
              heightRem={unitsHeightRem}
              defaultRem={UNITS_DEFAULT_REM}
              minRem={UNITS_MIN_REM}
              maxRem={UNITS_MAX_REM}
              drag={dragUnitsHeight}
              label="Resize units pane"
              testId="units-splitter"
              onCommit={setUnitsHeight}
            />
          ) : null}
          <div
            ref={unitsSlotRef}
            className={unitsSlotClass(collapsed, unitsHeightRem != null)}
            style={unitsSlotStyle(collapsed, unitsHeightRem) ?? undefined}
            data-map-overlay="bottom"
          >
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
