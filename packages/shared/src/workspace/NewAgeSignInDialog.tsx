import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { useEscapeToDismiss } from "./dismissLayer";
import { NewAgeSignInFields } from "./NewAgeSignInFields";
import {
  signInIsReady,
  signInMetaLine,
  signInTitle,
  type NewAgeSignInPhase
} from "./newAgeSignInView";

/**
 * Asks a New Age world for a token, and says what it answered.
 *
 * The password lives in this component's own state and nowhere else - the rule `SendOrdersDialog`
 * states, for the same reason. The token this produces has to outlive the dialog, which is the
 * whole point of the bead; the password does not, and does not.
 *
 * Nothing the world sent is rendered: the dialog receives a `phase` whose message is one of six
 * sentences `newAgeSignInView.ts` chose, never a reply body.
 */
export function NewAgeSignInDialog({
  rulesetLabel,
  host,
  turnNumber,
  suggestedFactionNumber,
  purpose,
  phase,
  onSignIn,
  onDismiss
}: {
  rulesetLabel: string;
  host: string;
  turnNumber: number | null;
  /** Prefills the faction number; the player can change it. `null` leaves the field empty. */
  suggestedFactionNumber: string | null;
  /**
   * Why this dialog is up, when it is not simply "sign in".
   *
   * Absent is the sign-in the header opens: the heading is `signInTitle(rulesetLabel)`, the confirm
   * button reads `Sign in`, there is no notice, and the aria-label is `Sign in to a New Age world`.
   * Present is a session that ran out inside another action - the heading names that action, the
   * notice says why the dialog appeared, and signing in goes on to do the thing already asked for.
   */
  purpose?: {
    heading: string;
    /** Shown above the fields in `text-danger`, `data-testid="newage-signin-notice"`. */
    notice: string;
    confirmLabel: string;
    ariaLabel: string;
  };
  phase: NewAgeSignInPhase;
  /** Cancel and Escape both abort an in-flight request, so this promises nothing. */
  onSignIn: (factionNumber: string, password: string) => void;
  onDismiss: () => void;
}) {
  const [factionNumber, setFactionNumber] = useState(suggestedFactionNumber ?? "");
  const [password, setPassword] = useState("");
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
    if (phase.kind === "failed" && phase.retype) {
      setPassword("");
      fieldRef.current?.focus();
    }
  }, [phase]);

  const canSignIn = signInIsReady(factionNumber, password, phase);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSignIn) {
      onSignIn(factionNumber.trim(), password);
    }
  };

  return (
    <div
      data-testid="newage-signin-backdrop"
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
        data-testid="newage-signin-panel"
        role="dialog"
        aria-modal="true"
        aria-label={purpose?.ariaLabel ?? "Sign in to a New Age world"}
        onSubmit={submit}
        className="flex w-[26rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-pane whitespace-normal shadow-lg"
      >
        <h2 className="text-ink">{purpose?.heading ?? signInTitle(rulesetLabel)}</h2>
        <p data-testid="newage-signin-meta" className="text-ink-soft">
          {signInMetaLine(host, turnNumber)}
        </p>
        {purpose === undefined ? null : (
          <p data-testid="newage-signin-notice" className="text-danger">
            {purpose.notice}
          </p>
        )}

        <NewAgeSignInFields
          factionNumber={factionNumber}
          password={password}
          phase={phase}
          fieldRef={fieldRef}
          onFactionNumber={setFactionNumber}
          onPassword={setPassword}
        />

        {/* Sign in above Cancel once the footer stacks, so the primary action stays nearest the field. */}
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button
            type="button"
            data-testid="newage-signin-cancel"
            onClick={onDismiss}
            className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            Cancel
          </button>
          <button
            type="submit"
            data-testid="newage-signin-confirm"
            disabled={!canSignIn}
            className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
          >
            {purpose?.confirmLabel ?? "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
