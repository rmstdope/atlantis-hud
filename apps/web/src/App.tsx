import { resolveFeatureFlags, RingBufferLogger, toJsonLines } from "@atlantis/shared";
import fileFlags from "../config/feature-flags.json";

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
  const flags = resolveFeatureFlags(fileFlags, import.meta.env as Record<string, unknown>);

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
