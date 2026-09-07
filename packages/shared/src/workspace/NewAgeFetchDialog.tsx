import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useEscapeToDismiss } from "./dismissLayer";
import { NewAgeSignInFields } from "./NewAgeSignInFields";
import {
  FETCH_CONFIRM,
  FETCH_SCOPE_THIS_TURN,
  FETCH_SCOPE_WITH_HISTORY,
  fetchDialogTitle,
  fetchWorkingLine,
  newAgeFetchIsReady,
  type NewAgeFetchPhase,
  type NewAgeFetchScope
} from "./newAgeFetchView";
import { credentialNote, signInMetaLine } from "./newAgeSignInView";

/**
 * Asks for a faction number and a password, fetches with them, and stays up until the work is done.
 *
 * There is no session: the credentials live in this component's own state and die with it, which
 * is the whole of what this bead means. Nothing the world sent is rendered - the dialog receives a
 * `phase` whose message is one of the sentences `newAgeSignInView.ts` chose, never a reply body.
 */
export function NewAgeFetchDialog({
  rulesetLabel,
  worldName,
  host,
  turnNumber,
  suggestedFactionNumber,
  phase,
  onFetch,
  onDismiss
}: {
  /** `New Age: Arcanum` - the heading. */
  rulesetLabel: string;
  /** `Arcanum` - the working lines. */
  worldName: string;
  host: string;
  turnNumber: number | null;
  /** Prefills the faction number; the player can change it. `null` leaves the field empty. */
  suggestedFactionNumber: string | null;
  phase: NewAgeFetchPhase;
  onFetch: (factionNumber: string, password: string, scope: NewAgeFetchScope) => void;
  /** Cancel and Escape both abandon whatever is running, so this promises nothing. */
  onDismiss: () => void;
}) {
  const [factionNumber, setFactionNumber] = useState(suggestedFactionNumber ?? "");
  const [password, setPassword] = useState("");
  // The dialog is mounted only while a fetch phase exists, so this resets on every open by
  // construction rather than by an effect (the navigator, round 3).
  const [scope, setScope] = useState<NewAgeFetchScope>("thisTurn");
  const fieldRef = useRef<HTMLInputElement | null>(null);
  // Whatever held focus when this mounted, so it can be given back on unmount - the rule
  // `ChipPopover` follows. This codebase has no focus trap and this dialog adds none.
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

  // A refusal says the credentials were wrong, so the password is cleared and keeps focus to be
  // retyped; the faction number is left as typed. Keyed on the phase's own `retype` rather than on
  // its message, so no string is ever compared to decide what to do.
  useEffect(() => {
    if (phase.kind === "ready" && phase.retype) {
      setPassword("");
      fieldRef.current?.focus();
    }
  }, [phase]);

  const canFetch = newAgeFetchIsReady(factionNumber, password, phase);
  const working = fetchWorkingLine(phase, worldName);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canFetch) {
      onFetch(factionNumber.trim(), password, scope);
    }
  };

  return (
    <div
      data-testid="newage-fetch-backdrop"
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
        data-testid="newage-fetch-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Fetch from a New Age world"
        onSubmit={submit}
        className="flex w-[26rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{fetchDialogTitle(rulesetLabel)}</h2>
        <p data-testid="newage-fetch-meta" className="text-ink-soft">
          {signInMetaLine(host, turnNumber)}
        </p>

        {working === null ? (
          <>
            <NewAgeSignInFields
              factionNumber={factionNumber}
              password={password}
              note={credentialNote("fetch")}
              phase={{ kind: "ready" }}
              fieldRef={fieldRef}
              onFactionNumber={setFactionNumber}
              onPassword={setPassword}
            />

            {phase.kind === "ready" && phase.message !== null ? (
              <p data-testid="newage-fetch-message" className="text-danger">
                {phase.message}
              </p>
            ) : null}

            <fieldset className="flex flex-col gap-1 border-0 p-0">
              <legend className="sr-only">What to fetch</legend>
              <label className="flex items-start gap-2 text-ink-soft">
                <input
                  data-testid="newage-fetch-scope-this-turn"
                  type="radio"
                  name="newage-fetch-scope"
                  checked={scope === "thisTurn"}
                  onChange={() => setScope("thisTurn")}
                />
                <span>{FETCH_SCOPE_THIS_TURN}</span>
              </label>
              <label className="flex items-start gap-2 text-ink-soft">
                <input
                  data-testid="newage-fetch-scope-history"
                  type="radio"
                  name="newage-fetch-scope"
                  checked={scope === "thisTurnAndHistory"}
                  onChange={() => setScope("thisTurnAndHistory")}
                />
                <span>{FETCH_SCOPE_WITH_HISTORY}</span>
              </label>
            </fieldset>
          </>
        ) : (
          <>
            <p data-testid="newage-fetch-working" className="text-ink-soft">
              {working}
            </p>
            {/* A total exists only for a run of turns; the single calls have nothing to divide. */}
            {phase.kind === "fetchingTurn" ? (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={phase.total}
                aria-valuenow={phase.done}
                className="h-1 w-full overflow-hidden rounded bg-panel"
              >
                <div
                  className="h-full bg-brass"
                  style={{ width: `${(phase.done / phase.total) * 100}%` }}
                />
              </div>
            ) : null}
          </>
        )}

        {/* Fetch above Cancel once the footer stacks, so the primary action stays nearest the field. */}
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button
            type="button"
            data-testid="newage-fetch-cancel"
            onClick={onDismiss}
            className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            Cancel
          </button>
          {working === null ? (
            <button
              type="submit"
              data-testid="newage-fetch-confirm"
              disabled={!canFetch}
              className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
            >
              {FETCH_CONFIRM}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
