import {
  ASSISTANT_FETCH_ASKS_LINE,
  ASSISTANT_FETCH_STOPPED_LINE,
  type AssistantFetchPrompt
} from "../assistant/assistantFetch";

/**
 * The line both Fetch dialogs carry at the top when the assistant asked for the fetch
 * (ah-9vmbx.3), marked by the brass left edge the Send dialogs' assistant line has. It stays
 * through every phase; only the assistant stopping waiting changes its words.
 */
export function AssistantFetchLine({ prompt }: { prompt: AssistantFetchPrompt | undefined }) {
  if (prompt === undefined) {
    return null;
  }
  return (
    <p data-testid="assistant-fetch-line" className="border-l-2 border-brass pl-2 text-ink">
      {prompt === "asking" ? ASSISTANT_FETCH_ASKS_LINE : ASSISTANT_FETCH_STOPPED_LINE}
    </p>
  );
}
