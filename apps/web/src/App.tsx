import { resolveFeatureFlags, RingBufferLogger, toJsonLines } from "@atlantis/shared";
import fileFlags from "../config/feature-flags.json";

const logger = new RingBufferLogger("web");

function downloadLogs() {
  const blob = new Blob([toJsonLines(logger.snapshot())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "web-logs.jsonl";
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const flags = resolveFeatureFlags(fileFlags, import.meta.env as Record<string, unknown>);
  logger.write("info", "web app initialized");

  return (
    <main>
      <h1>Atlantis HUD Web Shell</h1>
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
    </main>
  );
}
