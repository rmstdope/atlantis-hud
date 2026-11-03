import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, KeyboardEventHandler, RefObject } from "react";
import type { GameToSave, SaveAllOutcome } from "../oldAddress";
import {
  LAST_OLD_ADDRESS_VERSION,
  NEW_ADDRESS_LABEL,
  NEW_ADDRESS_URL,
  OLD_ADDRESS_HOST,
  failedLine,
  saveAllGames,
  savedLine,
  savingLabel
} from "../oldAddress";
import { useEscapeToDismiss } from "./dismissLayer";
import type { OpenExternal } from "./openExternal";
import { OPEN_EXTERNAL_IN_NEW_TAB } from "./openExternal";
import { wrappedFocusIndex } from "./ordersExportGuard";

/** Where "Save all my games" has got: not pressed yet, counting, or done with what it managed. */
export type OldAddressPhase =
  | { kind: "idle" }
  | { kind: "saving"; done: number; total: number }
  | { kind: "finished"; outcome: SaveAllOutcome };

const TITLE = "This address is closing down";

const plainButton =
  "rounded border border-edge px-3 py-0.5 text-ink-soft hover:border-brass hover:text-brass";
const primaryButton =
  "rounded border border-brass bg-brass/10 px-3 py-0.5 text-brass hover:bg-brass/20 disabled:opacity-50";

/** The new address as a link; the web shell is a browser, so a plain new-tab link is right here. */
function NewAddressLink() {
  return (
    <a
      href={NEW_ADDRESS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="text-select underline"
    >
      {NEW_ADDRESS_LABEL}
    </a>
  );
}

/**
 * The dialog drawn, hook-free so a test can render and walk it (the `OrdersExportWarningView`
 * pattern; docs/ui/old-address-notice.html is the agreed look).
 */
export function OldAddressNoticeView({
  hasGames,
  phase,
  onSaveAll,
  onStay,
  onGoToNewAddress,
  panelRef,
  saveButtonRef,
  onKeyDown
}: {
  hasGames: boolean;
  phase: OldAddressPhase;
  onSaveAll: () => void;
  onStay: () => void;
  onGoToNewAddress: () => void;
  panelRef?: RefObject<HTMLDivElement | null>;
  saveButtonRef?: RefObject<HTMLButtonElement | null>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  const outcome = phase.kind === "finished" ? phase.outcome : null;
  return (
    <div
      data-testid="old-address-backdrop"
      // Mounted over the report drop target: a file dropped on the backdrop is not an import.
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        ref={panelRef}
        data-testid="old-address-notice"
        role="dialog"
        aria-modal="true"
        aria-label={TITLE}
        // Focusable, so a click on the words keeps focus inside and the next Tab is still ours.
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex max-h-full w-[27rem] max-w-full flex-col overflow-y-auto rounded border border-brass bg-panel-raised p-4 text-pane whitespace-normal shadow-lg outline-none"
      >
        <h2 className="mb-2 text-brass">{TITLE}</h2>
        <p className="mb-2 text-ink-soft">
          Atlantis HUD has moved to <NewAddressLink />. This address, {OLD_ADDRESS_HOST}, gets no
          updates after version {LAST_OLD_ADDRESS_VERSION}.
        </p>
        {hasGames ? (
          <>
            <p className="mb-2 text-ink-soft">
              Your games are saved in this browser for this address only, so the new address cannot
              see them. To take them with you:
            </p>
            <ol className="mb-1 grid list-decimal gap-1 pl-5 text-ink-soft">
              <li>
                <button
                  ref={saveButtonRef}
                  type="button"
                  data-testid="old-address-save-all"
                  // Saving is the step the player must not skip, so it is where focus starts.
                  autoFocus
                  disabled={phase.kind === "saving"}
                  onClick={onSaveAll}
                  className={primaryButton}
                >
                  {phase.kind === "saving" ? savingLabel(phase.done, phase.total) : "Save all my games"}
                </button>{" "}
                — saves one backup file per game to your downloads.
                {outcome !== null && outcome.saved.length > 0 ? (
                  <p data-testid="old-address-saved" className="mt-1 break-words text-ok">
                    {savedLine(outcome.saved)}
                  </p>
                ) : null}
                {outcome?.failed.map((gameName) => (
                  <p key={gameName} data-testid="old-address-failed" role="alert" className="mt-1 text-danger">
                    {failedLine(gameName)}
                  </p>
                ))}
              </li>
              <li>
                Open <NewAddressLink />.
              </li>
              <li>
                There: choose <strong className="text-ink">Import game backup…</strong> and pick each
                file you saved.
              </li>
            </ol>
          </>
        ) : (
          <p className="mb-1 text-ink-soft">
            You have no games saved at this address, so there is nothing to move.
          </p>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" data-testid="old-address-stay" onClick={onStay} className={plainButton}>
            Stay here for now
          </button>
          <button
            type="button"
            data-testid="old-address-go"
            autoFocus={!hasGames}
            onClick={onGoToNewAddress}
            className={primaryButton}
          >
            Go to the new address
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tells a player at the old web address that it is closing down, and helps them take their games
 * to the new one (ah-gup7g). Opened at every launch there; nothing is remembered.
 *
 * Adds what a static render cannot: Escape closes, Tab stays among the dialog's controls, and
 * focus goes back on close to wherever it was before the dialog opened.
 */
export function OldAddressNotice({
  games,
  saveOne,
  openExternal = OPEN_EXTERNAL_IN_NEW_TAB,
  onClose
}: {
  games: readonly GameToSave[];
  /** Saves one game's backup; resolves as the shell's `TextFileSaver` does, `null` when cancelled. */
  saveOne: (game: GameToSave) => Promise<string | null>;
  openExternal?: OpenExternal;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<OldAddressPhase>({ kind: "idle" });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  // Read while rendering, before `autoFocus` moves focus into the dialog.
  const [returnFocusTo] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (returnFocusTo instanceof HTMLElement && returnFocusTo.isConnected) {
        returnFocusTo.focus();
      }
    },
    [returnFocusTo]
  );

  // Disabling the button while it counts drops focus to the page; give it back when it is done.
  useEffect(() => {
    if (phase.kind === "finished") {
      saveButtonRef.current?.focus();
    }
  }, [phase.kind]);

  useEscapeToDismiss(onClose);

  const saveAll = () => {
    void saveAllGames(games, saveOne, (done, total) => setPhase({ kind: "saving", done, total })).then(
      (outcome) => setPhase({ kind: "finished", outcome })
    );
  };

  const keepTabInside = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || panelRef.current === null) {
      return;
    }
    const controls = [
      ...panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]")
    ];
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    controls[wrappedFocusIndex(index, controls.length, event.shiftKey)]?.focus();
  };

  return (
    <OldAddressNoticeView
      hasGames={games.length > 0}
      phase={phase}
      onSaveAll={saveAll}
      onStay={onClose}
      onGoToNewAddress={() => openExternal(NEW_ADDRESS_URL)}
      panelRef={panelRef}
      saveButtonRef={saveButtonRef}
      onKeyDown={keepTabInside}
    />
  );
}
