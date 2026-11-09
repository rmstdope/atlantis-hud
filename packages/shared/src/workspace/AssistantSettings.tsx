import { useEffect, useState } from "react";
import { claudeAddCommand, type AssistantConnection, type AssistantTransport } from "../assistant/assistantTransport";
import { CopyButton } from "./CopyButton";

/**
 * Where Claude Code connects to this HUD, and the one command that connects it.
 *
 * Shown on the Global tab, and only by a shell that has an assistant transport - the desktop.
 */
export function AssistantSettings({ assistant }: { assistant: AssistantTransport }) {
  const [connection, setConnection] = useState<AssistantConnection | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    assistant
      .connection()
      .then((answer) => current && setConnection(answer))
      .catch((error: unknown) => current && setFailed(error instanceof Error ? error.message : String(error)));
    return () => {
      current = false;
    };
  }, [assistant]);

  return <AssistantSettingsView connection={connection} failed={failed} />;
}

/** The section as it reads for one answer, apart from the fetching so it can be tested. */
export function AssistantSettingsView({
  connection,
  failed
}: {
  connection: AssistantConnection | null;
  failed: string | null;
}) {
  const problem = failed ?? connection?.error ?? null;
  return (
    <section data-testid="assistant-settings" className="mt-3 border-t border-edge pt-3">
      <h3 className="m-0 text-brass">Claude assistant</h3>
      {problem !== null ? (
        <p data-testid="assistant-settings-problem" className="mt-1 text-danger">
          The assistant cannot connect: {problem}
        </p>
      ) : connection === null ? (
        <p className="mt-1 text-ink-soft">Looking for the assistant server...</p>
      ) : (
        <>
          <p className="mt-1 text-ink-soft">
            Claude Code can read this turn and write orders into it. Run this once in a terminal to connect it:
          </p>
          <pre
            data-testid="assistant-settings-command"
            className="mt-1 whitespace-pre-wrap break-all rounded border border-edge bg-panel p-2 text-xs"
          >
            {claudeAddCommand(connection)}
          </pre>
          <CopyButton text={claudeAddCommand(connection)} label="Copy" testId="assistant-settings-copy" />
        </>
      )}
    </section>
  );
}
