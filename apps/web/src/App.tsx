import { createCoreClient, createWasmAdapter, type GameInfo } from "@atlantis/core-client";
import {
  OrderEditorPanel,
  ReportImportPanel,
  resolveFeatureFlags,
  RingBufferLogger,
  toJsonLines
} from "@atlantis/shared";
import { useEffect, useMemo, useState } from "react";
import fileFlags from "../config/feature-flags.json";
import { resolveCoreWasmBindings } from "./coreWasmBridge";

const logger = new RingBufferLogger("web");
logger.write("info", "web app initialized");

function downloadLogs() {
  const blob = new Blob([toJsonLines(logger.snapshot())], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "web-logs.jsonl";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function App() {
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const flags = resolveFeatureFlags(fileFlags, import.meta.env as Record<string, unknown>);
  const client = useMemo(
    () => createCoreClient(createWasmAdapter(resolveCoreWasmBindings())),
    []
  );

  useEffect(() => {
    client
      .getGameInfo()
      .then((metadata) => {
        setGameInfo(metadata);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "unknown game metadata error";
        setLoadError(message);
      });
  }, [client]);

  return (
    <main>
      <h1>Atlantis HUD Web Shell</h1>
      <p data-testid="game-info">
        {gameInfo
          ? `${gameInfo.name} (${gameInfo.rulesetVersion}), factions: ${gameInfo.maxFactionCount}`
          : "Loading game metadata..."}
      </p>
      {loadError ? <p role="alert">failed to load game metadata: {loadError}</p> : null}
      <p data-testid="flag-status">
        structured logging demo enabled: {flags.enableStructuredLoggingDemo ? "yes" : "no"}
      </p>
      <button
        type="button"
        onClick={() => {
          logger.write("info", "manual web export requested");
          downloadLogs();
        }}
      >
        Download logs
      </button>
      <OrderEditorPanel client={client} />
      <ReportImportPanel client={client} />
    </main>
  );
}
