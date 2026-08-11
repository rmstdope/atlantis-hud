import type {
  CoreClient,
  GameManifest,
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
import { downloadTextFile, type TextFileSaver } from "../downloadFile";
import { exportFileName, exportRequestOf } from "../mapExport";
import { readUnitOrders, writeUnitOrders } from "../ordersDocument";
import { mergeTurn, rememberTurn, restoreLatestTurn, toStoredRegions } from "../gameMemory";
import { decideReportLoad, shouldConfirmOlderTurnLoad } from "../reportLoadDecision";
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
import { useWorkspaceStore } from "../workspaceStore";
import { useSettingsStore } from "../settingsStore";
import { AppHeader, type ImportStatus } from "./AppHeader";
import { GameGate } from "./GameGate";
import { SettingsDialog } from "./SettingsDialog";
import type { AppUpdateControl } from "./appUpdate";
import { UNSUPPORTED_UPDATES } from "./appUpdate";
import { ForeignReportPrompt } from "./ForeignReportPrompt";
import { GamePicker } from "./GamePicker";
import { MergedFactionsPanel } from "./MergedFactionsPanel";
import { LayerChips } from "./LayerChips";
import { MapCanvas } from "./MapCanvas";
import { MapExportDialog } from "./MapExportDialog";
import { MapSavedDialog } from "./MapSavedDialog";
import { type MapRect } from "./mapMarquee";
import { OrdersPanel } from "./OrdersPanel";
import type { OrdersEditorHandle } from "./OrdersEditor";
import { CommandPalette } from "./CommandPalette";
import { ShortcutHelp } from "./ShortcutHelp";
import { buildPaletteEntries } from "../commandPalette";
import { diagnosticTargets, stepDiagnostic } from "../diagnosticNav";
import { hasOpenDismissLayers } from "../dismissStack";
import { firesInContext, isMacPlatform, matchShortcut, SHORTCUTS } from "../shortcuts";
import { nextOwnUnit } from "../unitCycle";
import { ordersSlotClass, unitSlotClass } from "./panelLayout";
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
export { shouldConfirmOlderTurnLoad };

export function confirmOlderTurnLoad(currentTurn: number, loadedTurn: number): boolean {
  if (typeof globalThis.confirm !== "function") {
    return true;
  }
  return globalThis.confirm(
    `Turn ${loadedTurn} is older than the currently loaded turn ${currentTurn}. ` +
      "Load it anyway? It may not be the latest report."
  );
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
  const [helpOpen, setHelpOpen] = useState(false);
  // The map export: whether its dialog is open, the rectangle a Shift+drag left behind, and how
  // the last attempt went. The rectangle outlives the dialog so re-opening it offers the same
  // area, and a drag while the dialog is closed is remembered rather than wasted.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportRect, setExportRect] = useState<MapRect | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // The file just written, until the player has been told where it went.
  const [savedExport, setSavedExport] = useState<{ path: string | null; fileName: string } | null>(
    null
  );
  // The F8 walk's stop and its pending cross-unit landing. A ref for the stop: pressing F8
  // twice must not wait a render between the steps.
  const lastDiagnostic = useRef<number | null>(null);
  const [pendingProblem, setPendingProblem] = useState<
    ReturnType<typeof diagnosticTargets>[number] | null
  >(null);
  const ordersEditor = useRef<OrdersEditorHandle | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  // Which of the turn's two lists is being read, and whether either is. Local rather than in the
  // store, exactly as the game picker is: it is a panel that is open for a moment, not a preference.
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [messagesTab, setMessagesTab] = useState<TurnMessagesTab>("errors");
  // A report from another faction, parsed and waiting for the player to say what to do with it,
  // and whose reports have already been folded into the turn on screen.
  const [pendingLoad, setPendingLoad] = useState<PendingReportLoad | null>(null);
  const [mergedReports, setMergedReports] = useState<MergedReportRecord[]>([]);
  const [mergedOpen, setMergedOpen] = useState(false);

  const selectedRegionId = useWorkspaceStore((state) => state.selectedRegionId);
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectRegion = useWorkspaceStore((state) => state.selectRegion);
  const selectUnit = useWorkspaceStore((state) => state.selectUnit);
  const level = useWorkspaceStore((state) => state.level);
  const setLevel = useWorkspaceStore((state) => state.setLevel);
  const layers = useWorkspaceStore((state) => state.layers);
  const showTextures = useSettingsStore((state) => state.biomeTextures);
  const warnOnUnguardedHex = useSettingsStore((state) => state.warnOnUnguardedHex);
  const movementPlanner = useSettingsStore((state) => state.movementPlanner);
  const snippets = useSettingsStore((state) => state.snippets);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  // Which panels are folded is a layout question as well as a panel one: a folded panel hands the
  // space it gives up to the panel beside it, and only the shell knows what is beside what.
  const collapsed = useWorkspaceStore((state) => state.collapsed);
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
          label: "Keyboard shortcuts",
          binding: helpSpec ? (mac ? helpSpec.mac : helpSpec.other) : undefined,
          run: () => setHelpOpen(true)
        },
        // Only with a report on screen: an export needs a turn to name itself after and a map to
        // describe, and neither exists before one is imported.
        ...(parsed ? [{ id: "export-map", label: "Export map", run: () => openExport() }] : [])
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
    async (report: ParsedReport, text: string, fileName: string) => {
      try {
        setParsed(report);
        setRawReport(text);
        clearPlan();
        setRoute(null);

        // Commit the turn to the faction's game and read back every region it has ever seen.
        // A report on its own describes the hexes the faction stood in and names their neighbours,
        // but not *their* neighbours - so without this the map stops at the fringe and no route can
        // be longer than one step. Failing to remember is a warning, never a reason to withhold a
        // report that parsed perfectly well.
        // The same ruleset the report was parsed with, so what is remembered is classified the
        // way what is shown is. `null` when none could be fetched, which stores the estimates.
        const memory = game
          ? await rememberTurn(client, game, report, text, rulesetText, new Date().toISOString())
          : { remembered: [], merged: [], warning: null };
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
        const opening = buildHexMapModel(report);
        const openingHex = opening.hexes.find(
          (candidate) => candidate.regionId === opening.initialSelectedRegionId
        );
        selectRegion(opening.initialSelectedRegionId, unitsForHex(openingHex ?? null)[0]?.unitId ?? null);
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

        if (
          decision.kind === "confirmOlder" &&
          !confirmOlderTurnLoad(decision.currentTurn, decision.incomingTurn)
        ) {
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
    [client, ruleset, parsed, applyReport]
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
        if (useWorkspaceStore.getState().selectedRegionId === null) {
          const opening = buildHexMapModel(restored.parsed);
          const openingHex = opening.hexes.find(
            (candidate) => candidate.regionId === opening.initialSelectedRegionId
          );
          selectRegion(
            opening.initialSelectedRegionId,
            unitsForHex(openingHex ?? null)[0]?.unitId ?? null
          );
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
  }, [client, game, ruleset, selectRegion]);

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
      // the prompt holds a faction id and a turn that belong to another database entirely.
      setPendingLoad(null);
      setMergedReports([]);
      setMergedOpen(false);
      openGameInStore({
        gameId: opened.manifest.metadata.gameId,
        gameName: opened.manifest.metadata.gameName,
        databasePath: opened.databasePath,
        rulesetId: opened.manifest.metadata.rulesetId
      });
    },
    [clearPlan, openGameInStore]
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
        downloadTextFile(`${gameId}.atlantis-hud-game.json`, backup, "application/json");
        setPickerOpen(false);
      } catch (error: unknown) {
        setGameError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [client, flush]
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

  /** Writes a planned route into the selected unit's block, replacing any MOVE already there. */
  const applyRoute = useCallback(
    (order: string) => {
      if (!unit) {
        return;
      }
      setOrdersDocument((document) => {
        const existing = readUnitOrders(document, unit.unitId) ?? "";
        const withoutMove = existing
          .split("\n")
          .filter((line) => !/^\s*@?\s*(move|advance)\b/i.test(line))
          .join("\n")
          .trim();
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

  const exportOrders = useCallback(() => {
    downloadTextFile(
      `orders-turn-${parsed?.header.turnNumber ?? "unknown"}.txt`,
      ordersDocument,
      "text/plain"
    );
  }, [ordersDocument, parsed]);

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

        // A shell that can put the file where the player asks does; the browser gets the download
        // it is capable of. Only the first can say where the file went, and a cancelled save
        // dialog says nothing happened at all.
        if (saveTextFile) {
          const path = await saveTextFile(fileName, text);
          if (path === null) {
            return;
          }
          setSavedExport({ path, fileName });
        } else {
          downloadTextFile(fileName, text, "text/plain");
          setSavedExport({ path: null, fileName });
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
        busy={busy}
        onLoadReport={(text, fileName) => void loadReport(text, fileName)}
        onExportOrders={exportOrders}
        canExport={ordersDocument.length > 0}
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

      <div className="relative min-h-0 flex-1">
        <MapCanvas
          gameId={game?.manifest.metadata.gameId ?? null}
          model={model}
          level={level}
          selectedRegionId={selectedRegionId}
          onSelectRegion={selectHex}
          showStaleness={layers.staleness}
          showTextures={showTextures}
          showUnits={layers.units}
          showStructures={layers.structures}
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

        <div className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-center">
          <LayerChips levels={model.levels} />
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
            <div className="flex w-[19rem] min-h-0 flex-col">
              <RegionPanel
                hex={hex}
                unknown={unknownHex}
                problems={findingsForHex(validated.diagnostics, hex?.regionId ?? null)}
              />
            </div>

            <div className="flex w-[21rem] min-h-0 flex-col gap-2.5">
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
              <div className={ordersSlotClass(collapsed)}>
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

          <div className="max-h-[45vh] flex-none">
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
      {savedExport ? (
        <MapSavedDialog
          path={savedExport.path}
          fileName={savedExport.fileName}
          onDismiss={() => setSavedExport(null)}
        />
      ) : null}
      {keyboardPanels}
    </div>
  );
}

/** Exposed for tests and for panels that need to read a unit's slice without the shell. */
export { readUnitOrders };
