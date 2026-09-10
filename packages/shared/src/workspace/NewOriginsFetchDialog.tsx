import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useEscapeToDismiss } from "./dismissLayer";
import { NewAgeSignInFields } from "./NewAgeSignInFields";
import { credentialNote } from "./newAgeSignInView";
import {
  FETCH_CONFIRM,
  FETCH_DIALOG_TITLE,
  FETCH_WORKING,
  KEEP_WHAT_I_HAVE,
  LOAD_IT_AGAIN,
  fetchMetaLine,
  keepTurnLabel,
  newOriginsFetchIsReady,
  newerTurnQuestion,
  openTurnLabel,
  sameTurnQuestion,
  type NewOriginsFetchPhase
} from "./newOriginsFetchView";

/**
 * Asks for a faction number and a password, fetches this turn's report with them, and becomes the
 * question when what arrived would replace what is on screen.
 *
 * A component of its own rather than props on `NewAgeFetchDialog`: the two differ in the heading,
 * the whole shape of the meta line, the scope radios, the number of working lines and two
 * confirmation states the New Age one has none of. `NewAgeSignInFields` - the part that really is
 * identical - is shared, test ids and all.
 *
 * Nothing the site sent is rendered: the dialog receives a `phase` whose message is one of the
 * sentences `newOriginsFetchView.ts` chose or the site's own sentence out of its red block, never
 * a reply body.
 */
export function NewOriginsFetchDialog({
  host,
  factionName,
  factionNumber,
  turnNumber,
  suggestedFactionNumber,
  phase,
  onFetch,
  onKeep,
  onOpen,
  onDismiss
}: {
  host: string;
  /** For the meta line only. */
  factionName: string | null;
  factionNumber: string | null;
  turnNumber: number | null;
  /** Prefills the field; the player can change it. `null` leaves it empty. */
  suggestedFactionNumber: string | null;
  phase: NewOriginsFetchPhase;
  onFetch: (factionNumber: string, password: string) => void;
  /** `Keep turn 83` / `Keep what I have`. */
  onKeep: () => void;
  /** `Open turn 84` / `Load it again`. */
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const [typedFactionNumber, setTypedFactionNumber] = useState(suggestedFactionNumber ?? "");
  const [password, setPassword] = useState("");
  const fieldRef = useRef<HTMLInputElement | null>(null);
  // Whatever held focus when this mounted, so it can be given back on unmount - the rule
  // `NewAgeFetchDialog` follows. This codebase has no focus trap and this dialog adds none.
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

  // A refusal is most often a typo, so the password is cleared and keeps focus to be retyped; the
  // faction number is left as typed. Keyed on the phase's own `retype`, so no string is ever
  // compared to decide what to do - and false for unreachable and unreadable, where pressing Fetch
  // again is the whole of the retry.
  useEffect(() => {
    if (phase.kind === "ready" && phase.retype) {
      setPassword("");
      fieldRef.current?.focus();
    }
  }, [phase]);

  const canFetch = newOriginsFetchIsReady(typedFactionNumber, password, phase);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canFetch) {
      onFetch(typedFactionNumber.trim(), password);
    }
  };

  const asking = phase.kind === "askNewer" || phase.kind === "askSame";

  return (
    <div
      data-testid="neworigins-fetch-backdrop"
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
        data-testid="neworigins-fetch-panel"
        role="dialog"
        aria-modal="true"
        aria-label={FETCH_DIALOG_TITLE}
        onSubmit={submit}
        className="flex w-[26rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{FETCH_DIALOG_TITLE}</h2>
        <p data-testid="neworigins-fetch-meta" className="text-ink-soft">
          {fetchMetaLine({ factionName, factionNumber, turnNumber, host })}
        </p>

        {phase.kind === "ready" ? (
          <>
            <NewAgeSignInFields
              factionNumber={typedFactionNumber}
              password={password}
              note={credentialNote("fetch")}
              phase={{ kind: "ready" }}
              fieldRef={fieldRef}
              onFactionNumber={setTypedFactionNumber}
              onPassword={setPassword}
            />

            {phase.message === null ? null : (
              <p data-testid="neworigins-fetch-message" className="text-danger">
                {phase.message}
              </p>
            )}
          </>
        ) : null}

        {phase.kind === "fetching" ? (
          <p data-testid="neworigins-fetch-working" className="text-ink-soft">
            {FETCH_WORKING}
          </p>
        ) : null}

        {phase.kind === "askNewer" ? (
          <p data-testid="neworigins-fetch-question" className="text-ink-soft">
            {newerTurnQuestion(phase.currentTurn, phase.incomingTurn)}
          </p>
        ) : null}

        {phase.kind === "askSame" ? (
          <p data-testid="neworigins-fetch-question" className="text-ink-soft">
            {sameTurnQuestion(phase.turnNumber)}
          </p>
        ) : null}

        {/* The primary action above Cancel once the footer stacks, nearest the field. */}
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          {asking ? (
            <>
              <button
                type="button"
                data-testid="neworigins-fetch-keep"
                onClick={onKeep}
                className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
              >
                {phase.kind === "askNewer" ? keepTurnLabel(phase.currentTurn) : KEEP_WHAT_I_HAVE}
              </button>
              <button
                type="button"
                data-testid="neworigins-fetch-open"
                onClick={onOpen}
                className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10"
              >
                {phase.kind === "askNewer" ? openTurnLabel(phase.incomingTurn) : LOAD_IT_AGAIN}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="neworigins-fetch-cancel"
                onClick={onDismiss}
                className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
              >
                Cancel
              </button>
              {phase.kind === "ready" ? (
                <button
                  type="submit"
                  data-testid="neworigins-fetch-confirm"
                  disabled={!canFetch}
                  className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
                >
                  {FETCH_CONFIRM}
                </button>
              ) : null}
            </>
          )}
        </div>
      </form>
    </div>
  );
}
