import type { ImportedTurnRecord } from "@atlantis/core-client";
import { useMemo, useState } from "react";
import { buildMapViewModel } from "./mapData";
import { PixiHexMap } from "./PixiHexMap";

type MapWorkspaceClientLike = {
  commitReportImport(
    databasePath: string,
    projectId: string,
    confirmedFactionId: string,
    rawReport: string,
    allowOverwrite: boolean
  ): Promise<unknown>;
  loadImportedTurn(
    databasePath: string,
    projectId: string,
    factionId: string,
    turnNumber: number
  ): Promise<ImportedTurnRecord | null>;
};

type MapWorkspacePanelProps = {
  client: MapWorkspaceClientLike;
};

const SAMPLE_REPORT = `Atlantis Report For:
Crimson Tide (17) (Magic 5)
March, Year 1

Atlantis Engine Version: 5.2.5 (beta)
NewOrigins, Version: 3.0.0 (beta)

plain (12,34) in Coast of Dawn, contains Dawnhaven [town], 1200 peasants (humans), $500.
------------------------------------------------------------
  Wages: $12.0 (Max: $300).
  Products: 10 grain [GRAI].

Exits:
  North : forest (12,32) in Forest of Whispers.

* Guard Patrol (100), Crimson Tide (17), behind, 10 humans [HUMN].

forest (12,32) in Forest of Whispers, 800 peasants (humans), $200.
------------------------------------------------------------
  Wages: $10.0 (Max: $200).

* Ranger Squad (200), Crimson Tide (17), behind, 5 humans [HUMN].
`;

function useHandheldMode() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.innerWidth <= 768;
}

export function MapWorkspacePanel({ client }: MapWorkspacePanelProps) {
  const [databasePath, setDatabasePath] = useState("");
  const [projectId, setProjectId] = useState("");
  const [factionId, setFactionId] = useState("");
  const [turnNumberText, setTurnNumberText] = useState("");
  const [importedTurn, setImportedTurn] = useState<ImportedTurnRecord | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [panX, setPanX] = useState(36);
  const [panY, setPanY] = useState(36);
  const [zoom, setZoom] = useState(1);
  const handheldMode = useHandheldMode();
  const turnNumber = Number.parseInt(turnNumberText.trim(), 10);

  const mapViewModel = useMemo(() => {
    if (!importedTurn) {
      return { regions: [], initialSelectedRegionId: null };
    }
    return buildMapViewModel(importedTurn.parseResult);
  }, [importedTurn]);

  const selectedRegion = mapViewModel.regions.find((region) => region.regionId === selectedRegionId) ?? null;

  const canLoad =
    databasePath.trim().length > 0 &&
    projectId.trim().length > 0 &&
    factionId.trim().length > 0 &&
    Number.isFinite(turnNumber);

  const detailsPanel = selectedRegion ? (
    <article>
      <h3>{selectedRegion.regionId} - {selectedRegion.name}</h3>
      <p>units: {selectedRegion.units.length}</p>
      <ul>
        {selectedRegion.units.map((unit) => (
          <li key={unit.unitId}>
            {unit.unitId} - {unit.name}
          </li>
        ))}
      </ul>
    </article>
  ) : (
    <p>No region selected.</p>
  );

  return (
    <section data-testid="map-workspace-panel">
      <h2>Map workspace</h2>
      <label>
        Map database path
        <input
          type="text"
          value={databasePath}
          onChange={(event) => setDatabasePath(event.target.value)}
          placeholder="/tmp/campaign.atlantis-project.sqlite"
        />
      </label>
      <label>
        Map project id
        <input
          type="text"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          placeholder="faction-12"
        />
      </label>
      <label>
        Map faction id
        <input
          type="text"
          value={factionId}
          onChange={(event) => setFactionId(event.target.value)}
          placeholder="17"
        />
      </label>
      <label>
        Map turn number
        <input
          type="number"
          min={1}
          value={turnNumberText}
          onChange={(event) => setTurnNumberText(event.target.value)}
          placeholder="12"
        />
      </label>
      <div>
        <button
          type="button"
          onClick={() => {
            if (!canLoad) {
              setStatusMessage("set database, project, faction, and turn before seeding");
              return;
            }
            void client
              .commitReportImport(databasePath.trim(), projectId.trim(), factionId.trim(), SAMPLE_REPORT, true)
              .then(() => {
                setStatusMessage("seeded sample map import");
              })
              .catch((error: unknown) => {
                setStatusMessage(error instanceof Error ? error.message : "failed to seed sample map import");
              });
          }}
        >
          Seed sample map import
        </button>
        <button
          type="button"
          disabled={!canLoad}
          onClick={() => {
            if (!canLoad) {
              return;
            }
            void client
              .loadImportedTurn(databasePath.trim(), projectId.trim(), factionId.trim(), turnNumber)
              .then((loaded) => {
                setImportedTurn(loaded);
                if (!loaded) {
                  setSelectedRegionId(null);
                  setStatusMessage("no imported turn found for selection");
                  return;
                }

                const nextModel = buildMapViewModel(loaded.parseResult);
                setSelectedRegionId(nextModel.initialSelectedRegionId);
                setPanX(36);
                setPanY(36);
                setZoom(1);
                setStatusMessage(`loaded map turn ${turnNumber} with ${nextModel.regions.length} region(s)`);
              })
              .catch((error: unknown) => {
                setStatusMessage(error instanceof Error ? error.message : "failed to load map turn");
              });
          }}
        >
          Load map turn
        </button>
      </div>

      <p data-testid="map-selected-region-id">selected region: {selectedRegionId ?? "none"}</p>
      {statusMessage ? <p role="status">{statusMessage}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: handheldMode ? "1fr" : "2fr 1fr", gap: "1rem" }}>
        <div>
          <PixiHexMap
            regions={mapViewModel.regions}
            selectedRegionId={selectedRegionId}
            onSelectRegion={(regionId) => setSelectedRegionId(regionId)}
            panX={panX}
            panY={panY}
            scale={zoom}
          />
          <div>
            <button type="button" onClick={() => setPanX((value) => value - 20)}>Pan left</button>
            <button type="button" onClick={() => setPanX((value) => value + 20)}>Pan right</button>
            <button type="button" onClick={() => setPanY((value) => value - 20)}>Pan up</button>
            <button type="button" onClick={() => setPanY((value) => value + 20)}>Pan down</button>
            <button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}>Zoom out</button>
            <button type="button" onClick={() => setZoom((value) => Math.min(2.5, value + 0.1))}>Zoom in</button>
          </div>
        </div>

        <aside>
          <h3>Region hierarchy</h3>
          <ul>
            {mapViewModel.regions.map((region) => (
              <li key={region.regionId}>
                <button type="button" onClick={() => setSelectedRegionId(region.regionId)}>
                  {region.regionId} - {region.name} ({region.units.length})
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {!handheldMode ? <aside data-testid="map-right-inspector">{detailsPanel}</aside> : null}
      </div>

      {handheldMode ? <section data-testid="map-bottom-sheet">{detailsPanel}</section> : null}
    </section>
  );
}
