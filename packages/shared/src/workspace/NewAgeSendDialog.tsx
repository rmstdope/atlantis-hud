import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useEscapeToDismiss } from "./dismissLayer";
import { NewAgeSignInFields } from "./NewAgeSignInFields";
import {
  newAgeSendAsksRetype,
  newAgeSendConfirmLabel,
  newAgeSendErrors,
  newAgeSendFieldsPhase,
  newAgeSendIsReady,
  newAgeSendOutcome,
  newAgeSendSettles,
  newAgeSendTitle,
  newAgeSendWarnings,
  newAgeSendWorldMessage,
  type NewAgeSendPhase,
  type NewAgeSendTone
} from "./newAgeSendView";
import { metaLine } from "./sendOrdersView";

/**
 * Puts a turn's orders on a New Age world, and sets out what the world said back.
 *
 * The faction password lives in this component's own state and is never lifted into the shell -
 * the rule `SendOrdersDialog` and `NewAgeSignInDialog` both state, for the same reason. It is
 * handed to the shell for one send and dies with the component.
 *
 * A New Age world can save orders it also thinks are wrong, so this dialog says three things and
 * not two. Which one is `newAgeSendView.ts`'s to decide; this file only draws it.
 */
export function NewAgeSendDialog({
  worldName,
  factionLabel,
  turnNumber,
  host,
  asksSignIn,
  suggestedFactionNumber,
  phase,
  onSend,
  onDismiss
}: {
  /** `Arcanum` - the world's one short word, for the heading. */
  worldName: string;
  /** `Merchant Guild (27)`, or `Faction 27` when no report is loaded. */
  factionLabel: string;
  turnNumber: number | null;
  host: string;
  /** True when there is no session for this game, so the faction number is asked for too. */
  asksSignIn: boolean;
  /** Prefills the faction number; the player can change it. Ignored when `asksSignIn` is false. */
  suggestedFactionNumber: string | null;
  phase: NewAgeSendPhase;
  /**
   * The faction number is `""` when it was not asked for. Cancel and Escape abort, so this
   * promises nothing about delivery.
   */
  onSend: (factionNumber: string, password: string) => void;
  onDismiss: () => void;
}) {
  const [factionNumber, setFactionNumber] = useState(suggestedFactionNumber ?? "");
  const [password, setPassword] = useState("");
  const fieldRef = useRef<HTMLInputElement | null>(null);
  // Whatever held focus when this mounted, so it can be given back on unmount - the rule
  // `NewAgeSignInDialog` follows. This codebase has no focus trap and this dialog adds none.
  const openerRef = useRef<Element | null>(
    typeof document === "undefined" ? null : document.activeElement
  );

  useEscapeToDismiss(onDismiss);

  useEffect(() => {
    const opener = openerRef.current;
    return () => {
      if (opener instanceof HTMLElement) {
        opener.focus();
      }
    };
  }, []);

  // Where retyping the password is the fix, it is cleared and keeps focus. Keyed on the phase
  // rather than on any string, so nothing is ever compared to decide what to do.
  useEffect(() => {
    if (newAgeSendAsksRetype(phase)) {
      setPassword("");
      fieldRef.current?.focus();
    }
  }, [phase]);

  const settled = newAgeSendSettles(phase);
  const canSend = newAgeSendIsReady(asksSignIn, factionNumber, password, phase);
  const outcome = newAgeSendOutcome(phase, turnNumber);
  const errors = newAgeSendErrors(phase);
  const warnings = newAgeSendWarnings(phase);
  const worldMessage = newAgeSendWorldMessage(phase);
  const notice = phase.kind === "ready" ? phase.notice : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) {
      onSend(factionNumber.trim(), password);
    }
  };

  return (
    <div
      data-testid="newage-send-backdrop"
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
        data-testid="newage-send-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Send orders to a New Age world"
        onSubmit={submit}
        className="flex w-[26rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{newAgeSendTitle(worldName)}</h2>
        <p data-testid="newage-send-meta" className="text-ink-soft">
          {metaLine(factionLabel, turnNumber, host)}
        </p>

        {notice === null ? null : (
          <p data-testid="newage-send-notice" className="text-danger">
            {notice}
          </p>
        )}

        {settled ? null : (
          <NewAgeSignInFields
            asksToSignIn={asksSignIn}
            factionNumber={factionNumber}
            password={password}
            phase={newAgeSendFieldsPhase(phase)}
            fieldRef={fieldRef}
            onFactionNumber={setFactionNumber}
            onPassword={setPassword}
          />
        )}

        {outcome === null ? null : (
          <p data-testid="newage-send-outcome" className={toneClass(outcome.tone)}>
            {outcome.text}
          </p>
        )}

        {errors.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-ink-soft">Errors</span>
            {/* Fixed height rather than growing: a long list must not push Close out of reach. */}
            <ul
              data-testid="newage-send-errors"
              className="max-h-[7rem] list-disc overflow-auto rounded border border-edge bg-panel py-2 pl-8 pr-2 text-pane-sm text-ink"
            >
              {/* Keyed by index: the world can return the same sentence twice, and this list is
                  never reordered or filtered. */}
              {errors.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length === 0 ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-ink-soft">Warnings</span>
            <ul
              data-testid="newage-send-warnings"
              className="max-h-[7rem] list-disc overflow-auto rounded border border-edge bg-panel py-2 pl-8 pr-2 text-pane-sm text-ink"
            >
              {warnings.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {worldMessage === null ? null : (
          <div className="flex flex-col gap-1">
            <span className="text-ink-soft">The world reported</span>
            <p
              data-testid="newage-send-report"
              className="rounded border border-edge bg-panel p-2 text-pane-sm text-ink"
            >
              {worldMessage}
            </p>
          </div>
        )}

        {/* Send above Cancel once the footer stacks, so the primary action stays nearest the field. */}
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          {settled ? (
            <button
              type="button"
              data-testid="newage-send-close"
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
                data-testid="newage-send-cancel"
                onClick={onDismiss}
                className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="newage-send-confirm"
                disabled={!canSend}
                className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
              >
                {newAgeSendConfirmLabel(asksSignIn)}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

/** How loudly the outcome line reads. No `default`: a fifth tone is a typecheck failure here. */
function toneClass(tone: NewAgeSendTone): string {
  switch (tone) {
    case "soft":
      return "text-ink-soft";
    case "ok":
      return "text-ok";
    case "warn":
      return "text-warn";
    case "danger":
      return "text-danger";
  }
}
