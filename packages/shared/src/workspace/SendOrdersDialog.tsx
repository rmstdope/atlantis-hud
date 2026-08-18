import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useEscapeToDismiss } from "./dismissLayer";
import {
  metaLine,
  outcomeMessage,
  passwordProblem,
  showsServerReport,
  type SendOrdersPhase
} from "./sendOrdersView";

/**
 * Asks for the faction password, sends the turn, and says what the server answered.
 *
 * The password lives in this component's own state and nowhere else: it is handed to `onSend` and
 * goes with the component when it unmounts. Lifting it into the shell so a retry could reuse it
 * would put a faction's password in a component that lives for the whole session, which is the one
 * thing ah-etb0.2 must not do.
 *
 * Nothing the server sent is rendered except the two narrow extractors' output, which the dialog
 * receives already reduced to a `phase`. The response body echoes the orders back with the password
 * in cleartext, so it never comes near here.
 */
export function SendOrdersDialog({
  factionLabel,
  turnNumber,
  serverHost,
  phase,
  onSend,
  onDismiss
}: {
  factionLabel: string;
  turnNumber: number | null;
  serverHost: string;
  phase: SendOrdersPhase;
  /** Cancel and Escape both abort an in-flight request, so this promises nothing about delivery. */
  onSend: (password: string) => void;
  onDismiss: () => void;
}) {
  const [password, setPassword] = useState("");
  const fieldRef = useRef<HTMLInputElement | null>(null);

  useEscapeToDismiss(onDismiss);

  // After a refusal the password was probably wrong, so the field is cleared and keeps focus to be
  // retyped. An unreachable server says nothing about the password, so that one is left alone.
  useEffect(() => {
    if (phase.kind === "refused") {
      setPassword("");
      fieldRef.current?.focus();
    }
  }, [phase.kind]);

  const problem = passwordProblem(password);
  const canSend = phase.kind === "ready" && password.trim() !== "" && problem === null;
  const settled = phase.kind === "sent" || phase.kind === "refused" || phase.kind === "unreachable";
  const message = outcomeMessage(phase, turnNumber);
  const report = phase.kind === "sent" && showsServerReport(phase.serverReport) ? phase.serverReport : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) {
      onSend(password);
    }
  };

  return (
    <div
      data-testid="send-orders-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      // The dialog mounts inside the header, which is the report drop target: a file dropped on
      // the backdrop must not be read as an import.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <form
        data-testid="send-orders-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Send orders to the server"
        onSubmit={submit}
        className="flex w-[26rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">Send orders to the server</h2>
        <p data-testid="send-orders-meta" className="text-ink-soft">
          {metaLine(factionLabel, turnNumber, serverHost)}
        </p>

        {settled ? null : (
          <label className="flex flex-col gap-1">
            <span className="text-ink-soft">Faction password</span>
            <input
              ref={fieldRef}
              data-testid="send-orders-password"
              aria-label="Faction password"
              type="password"
              autoFocus
              placeholder="Required"
              value={password}
              disabled={phase.kind === "sending"}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
            />
          </label>
        )}

        {problem === null ? null : (
          <p data-testid="send-orders-problem" className="text-danger">
            {problem}
          </p>
        )}

        {message === null ? null : (
          <p data-testid="send-orders-outcome" className={phase.kind === "sent" ? "text-ink" : "text-ink-soft"}>
            {message}
          </p>
        )}

        {report === null ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-ink-soft">The server reported</span>
            {/* Fixed height rather than growing: a long report must not push Close out of reach. */}
            <pre
              data-testid="send-orders-report"
              className="max-h-[7rem] overflow-auto rounded border border-edge bg-panel p-2 text-pane-sm text-ink whitespace-pre-wrap"
            >
              {report}
            </pre>
          </div>
        )}

        {/* Send above Cancel once the footer stacks, so the primary action stays nearest the field. */}
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          {settled ? (
            <button
              type="button"
              data-testid="send-orders-close"
              autoFocus
              onClick={onDismiss}
              className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="send-orders-cancel"
                onClick={onDismiss}
                className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="send-orders-confirm"
                disabled={!canSend}
                className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
              >
                Send
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
