import type { CoreClient, ParsedReport } from "@atlantis/core-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildHexMapModel, unitsForHex, type HexMapModel } from "../hexMapModel";
import { readUnitOrders, writeUnitOrders } from "../ordersDocument";
import { useWorkspaceStore } from "../workspaceStore";
import { AppHeader, type ImportStatus } from "./AppHeader";
import { LayerChips } from "./LayerChips";
import { MapCanvas } from "./MapCanvas";
import { OrdersPanel } from "./OrdersPanel";
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
  const [ordersDocument, setOrdersDocument] = useState("");
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState({ errors: 0, warnings: 0 });
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const selectedRegionId = useWorkspaceStore((state) => state.selectedRegionId);
  const selectedUnitId = useWorkspaceStore((state) => state.selectedUnitId);
  const selectRegion = useWorkspaceStore((state) => state.selectRegion);
  const level = useWorkspaceStore((state) => state.level);
  const layers = useWorkspaceStore((state) => state.layers);

  const model = useMemo(() => (parsed ? buildHexMapModel(parsed) : EMPTY), [parsed]);

  /**
   * Selects a hex together with the first unit standing in it.
   *
   * `unitsForHex` sorts the player's own units first, so this lands on one of theirs whenever the
   * hex holds any, and only falls to a foreign unit when it does not.
   */
  const selectHex = useCallback(
    (regionId: string | null) => {
      const target = model.hexes.find((candidate) => candidate.regionId === regionId) ?? null;
      selectRegion(regionId, unitsForHex(target)[0]?.unitId ?? null);
    },
    [model, selectRegion]
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
        const report = await client.parseReportFull(text);
        setParsed(report);
        setOrdersDocument(report.ordersTemplate?.text ?? "");
        setSavedAt(null);

        const unitCount = report.regions.reduce((total, region) => total + region.units.length, 0);
        setStatus({
          regionCount: report.regions.length,
          unitCount,
          errorCount: report.header.errors.length,
          message: null,
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
    [client, selectRegion]
  );

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

  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      <AppHeader
        platformLabel={platformLabel}
        projectName={parsed ? "current turn" : null}
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
