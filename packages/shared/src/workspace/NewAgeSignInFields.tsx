import type { RefObject } from "react";

import { factionNumberProblem, type NewAgeSignInPhase } from "./newAgeSignInView";

/**
 * The two fields a New Age world asks for, the note under them, and whatever is wrong.
 *
 * Exported on its own because both the fetch and the send dialog ask for exactly these, and each
 * asks at the moment it acts: there is no session, so the fields are always both shown.
 *
 * Controlled throughout: neither value is held here, so the embedding dialog owns the password and
 * dies with it. Both fields are disabled rather than removed while a sign-in is in flight, so the
 * panel does not resize under the pointer.
 */
export function NewAgeSignInFields({
  factionNumber,
  password,
  note,
  phase,
  fieldRef,
  onFactionNumber,
  onPassword
}: {
  factionNumber: string;
  password: string;
  /** Under the password field: `credentialNote("fetch")` or `credentialNote("send")`. */
  note: string;
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
          placeholder="Required"
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

      <p className="text-ink-dim">{note}</p>

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
