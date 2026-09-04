import type { RefObject } from "react";

import {
  SIGN_IN_NOTE,
  factionNumberProblem,
  type NewAgeSignInPhase
} from "./newAgeSignInView";

/**
 * The two fields a New Age sign-in asks for, the note under them, and whatever is wrong.
 *
 * Exported on its own because `ah-lbd9.3` and `ah-lbd9.4` embed it: a session that has run out is
 * asked for again inside the dialog the player is already in, so nothing they have typed is lost.
 * That is the navigator's E1 decision, and this component is what it costs.
 *
 * Controlled throughout: neither value is held here, so the embedding dialog owns the password and
 * dies with it. Both fields are disabled rather than removed while a sign-in is in flight, so the
 * panel does not resize under the pointer.
 */
export function NewAgeSignInFields({
  factionNumber,
  password,
  phase,
  fieldRef,
  onFactionNumber,
  onPassword
}: {
  factionNumber: string;
  password: string;
  phase: NewAgeSignInPhase;
  /** The password input, so a refusal can clear it and put focus back in it. */
  fieldRef?: RefObject<HTMLInputElement | null>;
  onFactionNumber: (value: string) => void;
  onPassword: (value: string) => void;
}) {
  const busy = phase.kind === "signingIn";
  // A blank field the player has not finished typing in is not nagged at.
  const problem = factionNumberProblem(factionNumber, { blankIsAProblem: false });

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">Faction number</span>
        <input
          data-testid="newage-faction-number"
          aria-label="Faction number"
          type="text"
          inputMode="numeric"
          value={factionNumber}
          disabled={busy}
          onChange={(event) => onFactionNumber(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-ink-soft">Faction password</span>
        <input
          ref={fieldRef}
          data-testid="newage-password"
          aria-label="Faction password"
          type="password"
          autoFocus
          placeholder="Required"
          value={password}
          disabled={busy}
          onChange={(event) => onPassword(event.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
        />
      </label>

      <p className="text-ink-dim">{SIGN_IN_NOTE}</p>

      {problem === null ? null : (
        <p data-testid="newage-signin-problem" className="text-danger">
          {problem}
        </p>
      )}

      {phase.kind === "failed" ? (
        <p data-testid="newage-signin-message" className="text-danger">
          {phase.message}
        </p>
      ) : null}
    </>
  );
}
