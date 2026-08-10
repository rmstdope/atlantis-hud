import type {
  CoreClient,
  GameManifest,
  MergedReportRecord,
  OpenedGame,
  ParsedReport,
  RememberedRegion,
  RoutePlanResponse
} from "@atlantis/core-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildHexMapModel, unitsForHex, type HexMapModel } from "../hexMapModel";
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
import { shouldTriggerAutosave, type ValidatedOrders } from "../orderEditor";
import {
  gameAfterDelete,
  newGameId,
  newGameManifest,
  openNewestGame,
  rulesetUrlFor
} from "../gameSession";
import { useWorkspaceStore } from "../workspaceStore";
import { AppHeader, type ImportStatus } from "./AppHeader";
import { GameGate } from "./GameGate";
import { SettingsPanel } from "./SettingsPanel";
import type { AppUpdateControl } from "./appUpdate";
import { UNSUPPORTED_UPDATES } from "./appUpdate";
import { ForeignReportPrompt } from "./ForeignReportPrompt";
import { GamePicker } from "./GamePicker";
import { MergedFactionsPanel } from "./MergedFactionsPanel";
import { LayerChips } from "./LayerChips";
import { MapCanvas } from "./MapCanvas";
import { OrdersPanel } from "./OrdersPanel";
import { PlannerPanel } from "./PlannerPanel";
import { RegionPanel } from "./RegionPanel";
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
  appUpdate = UNSUPPORTED_UPDATES
}: {
  client: CoreClient;
  platformLabel: string;
  registerBeforeQuit?: RegisterBeforeQuit;
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
  const [route, setRoute] = useState<RoutePlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  // Which game is open, and every game there is. Both live here because both change together:
  // creating, switching and deleting all move the open game and the list in one step.
  const [game, setGame] = useState<OpenedGame | null>(null);
  const [games, setGames] = useState<GameManifest[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);
  // Which of the turn's two lists is being read, and whether either is. Local rather than in the
  // store, exactly as the game picker is: it is a panel that is open for a moment, not a preference.
  const [messagesOpen, setMessagesOpen] = useState(false);
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
  const planner = useWorkspaceStore((state) => state.planner);
  const armPlanner = useWorkspaceStore((state) => state.armPlanner);
  const planTo = useWorkspaceStore((state) => state.planTo);
  const clearPlan = useWorkspaceStore((state) => state.clearPlan);
  const openGameInStore = useWorkspaceStore((state) => state.openGame);
  const closeGameInStore = useWorkspaceStore((state) => state.closeGame);

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
        const memory = game
          ? await rememberTurn(client, game, report, text, new Date().toISOString())
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
          failed: false
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
          failed: true
        });
      }
    },
    [client, selectRegion, clearPlan, game]
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
          failed: true
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
          new Date().toISOString()
        );
        setRemembered(outcome.remembered);
        setMergedReports(outcome.merged);
        setStatus({
          regionCount: outcome.result.mergedRegionCount,
          unitCount: 0,
          message: describeMerge(outcome.result),
          failed: false
        });
      } catch (error) {
        setStatus({
          regionCount: 0,
          unitCount: 0,
          message: `could not merge ${pending.fileName}: ${describeError(error)}`,
          failed: true
        });
      } finally {
        setBusy(false);
      }
    })();
  }, [pendingLoad, client, game]);

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
        setParsed(restored.parsed);
        setRawReport(restored.rawReport);
        setRemembered(restored.remembered);
        // Whose reports were folded into this turn. Without it a reopened game shows the merged
        // hexes with nothing to say where they came from, which is the question the chip answers.
        setMergedReports(restored.merged);
        setOrdersDocument(restored.orders);
        setSave(savedStateFor(restored.ordersSavedAt));

        const unitCount = restored.parsed.regions.reduce(
          (total, region) => total + region.units.length,
          0
        );
        setStatus({
          regionCount: restored.parsed.regions.length,
          unitCount,
          message: restored.warning ?? `restored turn ${restored.turnNumber}`,
          failed: false
        });

        // Opening on a hex the player has units in, exactly as loading a report does.
        const opening = buildHexMapModel(restored.parsed);
        const openingHex = opening.hexes.find(
          (candidate) => candidate.regionId === opening.initialSelectedRegionId
        );
        selectRegion(
          opening.initialSelectedRegionId,
          unitsForHex(openingHex ?? null)[0]?.unitId ?? null
        );
      })
      .catch((error: unknown) => {
        // A game whose stored turn will not come back must say so. Silence here is exactly the
        // empty workspace this issue is about, only now with a reason nobody can see.
        if (!cancelled) {
          setStatus({
            regionCount: 0,
            unitCount: 0,
            message: `the last turn could not be restored: ${describeError(error)}`,
            failed: true
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
            failed: true
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
        .validateOrders(ordersDocument)
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
  }, [client, ordersDocument]);

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
    const blob = new Blob([ordersDocument], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orders-turn-${parsed?.header.turnNumber ?? "unknown"}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [ordersDocument, parsed]);

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

  // The same panel on both screens below, because settings are not part of the workspace: they are
  // part of the application, and the application exists before any game does.
  const settingsPanel = (
    <SettingsPanel
      platformLabel={platformLabel}
      appUpdate={appUpdate}
      onDismiss={() => setSettingsOpen(false)}
    />
  );

  // No game means there is nowhere to put a report, an order or a remembered map, so the workspace
  // is not rendered at all and creating a game is the only thing on offer.
  if (!game) {
    return (
      <GameGate
        platformLabel={platformLabel}
        busy={busy}
        error={gameError}
        onCreate={(name, rulesetId) => void createGame(name, rulesetId)}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        settings={settingsPanel}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      <AppHeader
        platformLabel={platformLabel}
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
        busy={busy}
        onLoadReport={(text, fileName) => void loadReport(text, fileName)}
        onExportOrders={exportOrders}
        canExport={ordersDocument.length > 0}
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
          model={model}
          level={level}
          selectedRegionId={selectedRegionId}
          onSelectRegion={selectHex}
          showStaleness={layers.staleness}
          showUnits={layers.units}
          route={layers.movement ? (route?.plan?.steps.map((step) => step.to) ?? []) : []}
          routeRisk={layers.movement ? (route?.risk?.hexes ?? []) : []}
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
        */}
        <div className="pointer-events-none absolute inset-0 flex flex-col gap-2.5 p-2.5 pt-12">
          <div className="flex min-h-0 flex-1 justify-between gap-2.5">
            <div className="pointer-events-auto flex w-[19rem] min-h-0 flex-col">
              <RegionPanel hex={hex} />
            </div>

            <div className="pointer-events-auto flex w-[21rem] min-h-0 flex-col gap-2.5">
              {/* The unit panel yields space so the orders editor keeps a usable number of rows. */}
              <div className="min-h-0 flex-1">
                <UnitPanel unit={unit} hex={hex} />
              </div>
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
              <div className="h-[19rem] max-h-[55%] min-h-[9rem] flex-none">
                <OrdersPanel
                  unit={unit}
                  hex={hex}
                  document={ordersDocument}
                  ownFactionName={factionLabel ?? "your faction"}
                  onChange={onOrdersChange}
                  validated={validated}
                  save={save}
                />
              </div>
            </div>
          </div>

          <div className="pointer-events-auto max-h-[45vh] flex-none">
            <UnitTableDock hex={hex} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Exposed for tests and for panels that need to read a unit's slice without the shell. */
export { readUnitOrders };
