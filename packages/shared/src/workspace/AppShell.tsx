import type {
  CoreClient,
  GameManifest,
  OpenedGame,
  ParsedReport,
  RememberedRegion,
  RoutePlanResponse
} from "@atlantis/core-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildHexMapModel, unitsForHex, type HexMapModel } from "../hexMapModel";
import { readUnitOrders, writeUnitOrders } from "../ordersDocument";
import { rememberTurn, toStoredRegions } from "../gameMemory";
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
import { GamePicker } from "./GamePicker";
import { LayerChips } from "./LayerChips";
import { MapCanvas } from "./MapCanvas";
import { OrdersPanel } from "./OrdersPanel";
import { PlannerPanel } from "./PlannerPanel";
import { RegionPanel } from "./RegionPanel";
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

const EMPTY: HexMapModel = {
  hexes: [],
  levels: [1],
  currentTurn: null,
  initialSelectedRegionId: null
};

/**
 * The whole workspace, shared by both platforms.
 *
 * Both shells render this and differ only in which `CoreClient` they hand it, which is what makes
 * the desktop and the web builds identical rather than merely similar. Previously each shell had
 * its own copy of the layout.
 */
export function AppShell({
  client,
  platformLabel
}: {
  client: CoreClient;
  platformLabel: string;
}) {
  const [parsed, setParsed] = useState<ParsedReport | null>(null);
  // Everywhere the faction has ever been, not just this turn. Without it the map stops at the
  // fringe of the current report and no route can be longer than one step.
  const [remembered, setRemembered] = useState<RememberedRegion[]>([]);
  const [ordersDocument, setOrdersDocument] = useState("");
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState({ errors: 0, warnings: 0 });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // The planner takes the report as text: the core parses it again in milliseconds, and a stateless
  // call means no session to invalidate when a new turn arrives.
  const [rawReport, setRawReport] = useState("");
  const [ruleset, setRuleset] = useState<string | null>(null);
  const [route, setRoute] = useState<RoutePlanResponse | null>(null);
  const [planning, setPlanning] = useState(false);
  // Which game is open, and every game there is. Both live here because both change together:
  // creating, switching and deleting all move the open game and the list in one step.
  const [game, setGame] = useState<OpenedGame | null>(null);
  const [games, setGames] = useState<GameManifest[]>([]);
  const [gamesLoaded, setGamesLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);

  const selectedRegionId = useWorkspaceStore((state) => state.selectedRegionId);
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectRegion = useWorkspaceStore((state) => state.selectRegion);
  const level = useWorkspaceStore((state) => state.level);
  const layers = useWorkspaceStore((state) => state.layers);
  const planner = useWorkspaceStore((state) => state.planner);
  const armPlanner = useWorkspaceStore((state) => state.armPlanner);
  const planTo = useWorkspaceStore((state) => state.planTo);
  const clearPlan = useWorkspaceStore((state) => state.clearPlan);
  const openGameInStore = useWorkspaceStore((state) => state.openGame);
  const closeGameInStore = useWorkspaceStore((state) => state.closeGame);

  // The map wants remembered regions flattened; the planner wants them as they are. Both come from
  // the same list, so neither can drift out of step with the other.
  const storedRegions = useMemo(() => toStoredRegions(remembered), [remembered]);
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

  const loadReport = useCallback(
    async (text: string, fileName: string) => {
      setBusy(true);
      try {
        // Classified when the ruleset is to hand, so a unit's men are counted rather than guessed.
        // Without it every unit reads as an estimate, including the single-race majority where the
        // leading-group figure is exactly right.
        const report = ruleset
          ? await client.parseReportClassified(text, ruleset)
          : await client.parseReportFull(text);
        setParsed(report);
        setRawReport(text);
        clearPlan();
        setRoute(null);
        setOrdersDocument(report.ordersTemplate?.text ?? "");
        setSavedAt(null);

        // Commit the turn to the faction's game and read back every region it has ever seen.
        // A report on its own describes the hexes the faction stood in and names their neighbours,
        // but not *their* neighbours - so without this the map stops at the fringe and no route can
        // be longer than one step. Failing to remember is a warning, never a reason to withhold a
        // report that parsed perfectly well.
        const memory = game
          ? await rememberTurn(client, game, report, text, new Date().toISOString())
          : { remembered: [], warning: null };
        setRemembered(memory.remembered);

        const unitCount = report.regions.reduce((total, region) => total + region.units.length, 0);
        setStatus({
          regionCount: report.regions.length,
          unitCount,
          errorCount: report.header.errors.length,
          message: memory.warning,
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
          errorCount: 0,
          message: `could not read ${fileName}: ${describeError(error)}`,
          failed: true
        });
      } finally {
        setBusy(false);
      }
    },
    // `ruleset` belongs here: without it the callback closes over the value at first render, which
    // is null, and every report is parsed unclassified however long the ruleset took to arrive.
    // `game` for the same reason: a report loaded after switching games must land in the new one.
    [client, selectRegion, ruleset, clearPlan, game]
  );

  // The ruleset is a served file rather than something compiled in, so a movement value can be
  // corrected by editing it and reloading. Which file is the open game's business: a game records
  // the ruleset it is played under, and two games on different servers do not share movement costs.
  // Its absence is not fatal: everything except the planner works without it.
  useEffect(() => {
    if (!game) {
      setRuleset(null);
      return undefined;
    }

    let cancelled = false;
    void Promise.resolve()
      .then(() => fetch(rulesetUrlFor(game.manifest.metadata.rulesetId)))
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => {
        if (!cancelled) {
          setRuleset(text);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuleset(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [game]);

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
      setSavedAt(null);
      setRoute(null);
      clearPlan();
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
        enterGame(await client.openGame(gameId, new Date().toISOString()));
        await refreshGames();
        setPickerOpen(false);
      } catch (error: unknown) {
        setGameError(describeError(error));
      } finally {
        setBusy(false);
      }
    },
    [client, enterGame, refreshGames]
  );

  const createGame = useCallback(
    async (name: string, rulesetId: string) => {
      setBusy(true);
      setGameError(null);
      try {
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
    [client, enterGame, refreshGames]
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
   */
  const deleteGame = useCallback(
    async (gameId: string) => {
      setBusy(true);
      setGameError(null);
      try {
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
    [client, enterGame, game, closeGameInStore]
  );

  // A destination and a unit are all the planner needs; the answer carries either a route or the
  // reason there is none.
  useEffect(() => {
    const destination = planner.destinationId;
    if (!destination || !unit?.own || !ruleset || !rawReport) {
      return undefined;
    }

    let cancelled = false;
    setPlanning(true);
    void client
      .planRoute(ruleset, rawReport, JSON.stringify(remembered), unit.unitId, destination)
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
            errorCount: 0,
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
  }, [client, planner.destinationId, unit, ruleset, rawReport, remembered]);

  // Validation follows the document, debounced so it does not run on every keystroke.
  useEffect(() => {
    if (!ordersDocument) {
      setDiagnostics({ errors: 0, warnings: 0 });
      return undefined;
    }
    const timer = setTimeout(() => {
      void client.validateOrders(ordersDocument).then((result) => {
        setDiagnostics({
          errors: result.diagnostics.filter((entry) => entry.severity === "error").length,
          warnings: result.diagnostics.filter((entry) => entry.severity === "warning").length
        });
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [client, ordersDocument]);

  const onOrdersChange = useCallback((unitId: string, orders: string) => {
    setOrdersDocument((document) => writeUnitOrders(document, unitId, orders));
    setSavedAt(new Date().toLocaleTimeString());
  }, []);

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
        return writeUnitOrders(document, unit.unitId, next);
      });
      setSavedAt(new Date().toLocaleTimeString());
    },
    [unit]
  );

  const exportOrders = useCallback(() => {
    const blob = new Blob([ordersDocument], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `orders-turn-${parsed?.header.turnNumber ?? "unknown"}.txt`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [ordersDocument, parsed]);

  const factionLabel = parsed?.header.factionName
    ? `${parsed.header.factionName} (${parsed.header.factionId})`
    : null;
  const turnLabel =
    parsed?.header.turnNumber === null || parsed?.header.turnNumber === undefined
      ? null
      : `${parsed.header.turnNumber} · ${parsed.header.month}, Year ${parsed.header.year}`;

  // Nothing until the games are known: rendering the gate first and the workspace a moment later
  // would flash "no game yet" at a player who has several.
  if (!gamesLoaded) {
    return <div className="h-full bg-ground" />;
  }

  // No game means there is nowhere to put a report, an order or a remembered map, so the workspace
  // is not rendered at all and creating a game is the only thing on offer.
  if (!game) {
    return (
      <GameGate
        platformLabel={platformLabel}
        busy={busy}
        error={gameError}
        onCreate={(name, rulesetId) => void createGame(name, rulesetId)}
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
        status={status}
        busy={busy}
        onLoadReport={(text, fileName) => void loadReport(text, fileName)}
        onExportOrders={exportOrders}
        canExport={ordersDocument.length > 0}
      />

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
                  errorCount={diagnostics.errors}
                  warningCount={diagnostics.warnings}
                  savedAt={savedAt}
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
