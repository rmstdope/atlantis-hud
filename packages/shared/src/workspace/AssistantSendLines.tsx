import { useEffect, useRef } from "react";
import { ASSISTANT_ASKS_LINE, ASSISTANT_STOPPED_LINE, type AssistantPrompt } from "../assistant/assistantSend";

/**
 * What both Send dialogs add when the assistant asked for the send (ah-9vmbx.2): its line, marked by
 * a brass left edge, and the reminders under it until there is a result. Nothing while the prompt
 * has stopped - the dialog then says `AssistantStoppedLine` instead.
 */
export function AssistantAskLines({ prompt, settled }: { prompt: AssistantPrompt | undefined; settled: boolean }) {
  if (prompt?.kind !== "asking") {
    return null;
  }
  return (
    <>
      <p data-testid="assistant-send-line" className="border-l-2 border-brass pl-2 text-ink">
        {ASSISTANT_ASKS_LINE}
      </p>
      {settled ? null : (
        <div
          data-testid="assistant-send-reminders"
          className="flex flex-col gap-0.5 rounded border border-edge bg-panel px-2 py-1"
        >
          {prompt.reminders.map((reminder) => (
            <p key={reminder.text} className={reminder.tone === "warn" ? "text-warn" : "text-ink-soft"}>
              {reminder.text}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

/** The one sentence a prompt shows once the assistant stopped waiting. */
export function AssistantStoppedLine() {
  return (
    <p data-testid="assistant-send-stopped" className="text-ink-soft">
      {ASSISTANT_STOPPED_LINE}
    </p>
  );
}

/**
 * Gives focus back to whatever held it when the dialog opened, as it closes - for a prompt the
 * assistant opened over whatever the player was doing. Off for the player's own Send, which keeps
 * today's behaviour.
 */
export function useFocusBackOnClose(active: boolean) {
  const opener = useRef<Element | null>(typeof document === "undefined" ? null : document.activeElement);
  const wanted = useRef(active);
  useEffect(() => {
    const element = opener.current;
    return () => {
      if (wanted.current && element instanceof HTMLElement) {
        element.focus();
      }
    };
  }, []);
}
