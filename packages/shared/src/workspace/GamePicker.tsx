import type { MapShape } from "@atlantis/core-client";
import type { GameManifest } from "@atlantis/core-client";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { BackupImportMode } from "../gameBackup";
import { backupGameIdentity } from "../gameBackup";
import { gameNameOf } from "../gameSession";
import { describeError } from "./shellAction";
import { useEscapeToDismiss } from "./dismissLayer";
import { GameForm } from "./GameForm";
import { PopoverFrame } from "./popover";

/**
 * The one panel behind a game row's `✕` (ah-58n): Delete, Reset or Cancel.
 *
 * A component rather than markup inline in the row, because it holds a hook - `useEscapeToDismiss`
 * cannot be called from inside the `map` callback that renders the rows.
 *
 * `failure` replaces the question rather than joining it: once one of the two has been pressed and
 * refused, what is left to say is why, and whether to try that same thing again. Which of the two
 * to repeat is the caller's to remember - `onRetry` - so Try again is never a guess made from the
 * wording of the message.
 */
export function RemoveGameConfirm({
  gameId,
  gameName,
  busy,
  failure,
  onDelete,
  onReset,
  onRetry,
  onCancel
}: {
  gameId: string;
  gameName: string;
  busy: boolean;
  /** What went wrong last time one of the two was pressed, or null. */
  failure: string | null;
  onDelete: () => void;
  onReset: () => void;
  /** Repeats whichever of the two produced `failure`. */
  onRetry: () => void;
  onCancel: () => void;
}) {
  // Not while one of the two is in flight. The panel is the only place either failure is reported,
  // so a panel dismissed mid-action would leave a failed delete or reset entirely unannounced -
  // Escape and Cancel both wait, and the buttons are disabled anyway.
  useEscapeToDismiss(() => {
    if (!busy) {
      onCancel();
    }
  });

  // The button the player pressed unmounts when the failure replaces the question, which would
  // otherwise drop focus to the body. `autoFocus` only fires when the panel mounts, so Try again
  // has to be given focus as it appears.
  const retryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (failure !== null) {
      retryRef.current?.focus();
    }
  }, [failure]);

  return (
    <div data-testid={`game-delete-confirm-${gameId}`} className="mt-1 rounded border border-danger/40 p-1.5">
      {failure === null ? (
        <>
          <p className="text-ink-soft">Delete “{gameName}”, or empty it and keep the game?</p>
          <p className="mt-1 text-ink-soft">
            Either way its turns, orders, remembered map and notes are erased. Reset keeps the name
            and ruleset.
          </p>
          <p className="mt-1 text-ink-dim">Export it first if you might want it back.</p>
        </>
      ) : (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <div className="mt-1.5 flex justify-end gap-1.5">
        {failure === null ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="rounded border border-danger px-2 py-0.5 text-danger disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onReset}
              className="rounded border border-warn px-2 py-0.5 text-warn disabled:opacity-50"
            >
              Reset
            </button>
          </>
        ) : (
          <button
            type="button"
            ref={retryRef}
            disabled={busy}
            onClick={onRetry}
            className="rounded border border-danger px-2 py-0.5 text-danger disabled:opacity-50"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          autoFocus
          disabled={busy}
          onClick={onCancel}
          className="rounded border border-edge px-2 py-0.5 text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The games the player has, and what can be done with them.
 *
 * A panel anchored under the header indicator rather than a centred modal: switching games is a
 * small, frequent act, and darkening the whole workspace to ask which of two names you meant is
 * more ceremony than the question deserves. It closes on Escape and on a click elsewhere, which is
 * what a player expects of something that opened under the thing they pressed.
 *
 * The `✕` on a row asks first, inline, and offers both ways of getting rid of what is in a game:
 * Delete, which takes the game with it, and Reset, which empties it and keeps the name and ruleset
 * (ah-58n). There is no undo anywhere in this application, and a game holds a season of turns.
 *
 * Importing a backup of a game that is already here asks the same way (ah-c0m) - Replace, Keep
 * both, or Cancel - and says what replacing erases.
 *
 * The name can be changed in place from the This game tab (ah-lkw); the same rule that decides
 * what a name may be at creation decides it here too.
 */
export function GamePicker({
  games,
  currentGameId,
  busy,
  error,
  onOpen,
  onCreate,
  onDelete,
  onReset,
  onExport,
  onImport,
  onRename
}: {
  games: GameManifest[];
  currentGameId: string | null;
  busy: boolean;
  error: string | null;
  onOpen: (gameId: string) => void;
  onCreate: (name: string, rulesetId: string, map?: MapShape) => void;
  /** Resolves `null` when the game is gone, or the reason it is not. */
  onDelete: (gameId: string) => Promise<string | null>;
  /** Resolves `null` when the game has been emptied, or the reason it has not. */
  onReset: (gameId: string) => Promise<string | null>;
  onExport: (gameId: string) => void;
  onImport: (file: File, mode: BackupImportMode) => void;
  onRename: (name: string) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(games.length === 0);
  const [confirmingRemovalOf, setConfirmingRemovalOf] = useState<string | null>(null);
  // What the last Delete or Reset refused to do, and which of the two it was, so Try again repeats
  // that one rather than being guessed from the message.
  const [removalFailure, setRemovalFailure] = useState<{
    gameId: string;
    action: "delete" | "reset";
    message: string;
  } | null>(null);
  const [tab, setTab] = useState<"games" | "settings">("games");
  const [pendingImport, setPendingImport] = useState<{ file: File; gameName: string } | null>(null);
  // `null` = at rest; a string = the draft currently in the field.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const importButtonRef = useRef<HTMLButtonElement | null>(null);
  const renameLinkRef = useRef<HTMLButtonElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  // One `✕` per row, so cancelling its panel can hand the focus back to the control that opened it.
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());

  const sorted = [...games].sort((left, right) =>
    right.lastOpenedAt.localeCompare(left.lastOpenedAt)
  );
  const currentGame =
    currentGameId === null ? null : sorted.find((game) => game.metadata.gameId === currentGameId) ?? null;

  useEffect(() => {
    if (!currentGame) {
      setTab("games");
    }
  }, [currentGame]);

  const isRenaming = renaming !== null;
  const trimmedDraft = renaming?.trim() ?? "";
  const duplicate =
    isRenaming &&
    trimmedDraft !== "" &&
    trimmedDraft !== currentGame?.metadata.gameName &&
    games.some(
      (candidate) =>
        candidate.metadata.gameId !== currentGameId && candidate.metadata.gameName === trimmedDraft
    )
      ? trimmedDraft
      : null;

  // Select-all on open, so typing replaces the whole name (as drawn in the mockup) - keyed on
  // `isRenaming` rather than `renaming` so it runs once per open, not on every keystroke. And the
  // Rename link gets focus back once it re-mounts on close: at the moment `cancel`/`save` call
  // `setRenaming(null)` the link is not in the DOM yet (React has not re-rendered), so the focus
  // has to happen from an effect. `wasRenaming` guards against focusing the link on every render
  // where editing merely was not entered (e.g. switching to this tab, or the initial mount).
  const wasRenamingRef = useRef(false);
  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.select();
    } else if (wasRenamingRef.current) {
      renameLinkRef.current?.focus();
    }
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  const cancelRename = () => {
    setRenaming(null);
    setRenameError(null);
  };

  const saveRename = async () => {
    if (renaming === null || !currentGame) {
      return;
    }
    let name: string;
    try {
      name = gameNameOf(renaming);
    } catch (error) {
      setRenameError(describeError(error));
      return;
    }
    if (name === currentGame.metadata.gameName) {
      // Nothing to write.
      cancelRename();
      return;
    }
    if (await onRename(name)) {
      cancelRename();
    }
    // Else: the field stays open with the typed name; the picker's own error line (below) says
    // why, and Save can be retried.
  };

  /** Closes the remove panel and hands the focus back to the `✕` that opened it. */
  const closeRemoval = (gameId: string) => {
    setConfirmingRemovalOf(null);
    setRemovalFailure(null);
    removeButtons.current.get(gameId)?.focus();
  };

  /**
   * Runs Delete or Reset and keeps the panel open when it refuses.
   *
   * Both report here rather than in the picker's shared error line below: the panel is where the
   * player pressed the button, and one panel reporting its two failures in two different places
   * depending on which was pressed is worse than either.
   */
  const removeGame = async (gameId: string, gameName: string, action: "delete" | "reset") => {
    const reason = await (action === "delete" ? onDelete(gameId) : onReset(gameId));
    if (reason === null) {
      setRemovalFailure(null);
      return;
    }
    const verb = action === "delete" ? "deleted" : "reset";
    setRemovalFailure({ gameId, action, message: `“${gameName}” could not be ${verb}: ${reason}` });
  };

  const onPickImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    void (async () => {
      // A read failure here (the file vanished, a permission error) is rare and would otherwise
      // be an unhandled rejection; fall through to a plain import and let the core report it in
      // the words it already uses, rather than leaving the player with no feedback at all.
      let text: string;
      try {
        text = await file.text();
      } catch {
        onImport(file, "new");
        return;
      }
      const identity = backupGameIdentity(text);
      const existing = identity ? games.find((game) => game.metadata.gameId === identity.gameId) : undefined;
      if (existing) {
        setPendingImport({ file, gameName: existing.metadata.gameName });
      } else {
        onImport(file, "new");
      }
    })();
  };

  return (
    <PopoverFrame testId="game-picker" label="Games" align="left" width="w-72" padding="p-2">
      {currentGame ? (
        <div role="tablist" aria-label="Game picker tabs" className="mb-1.5 flex gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "games"}
            data-testid="game-picker-tab-games"
            onClick={() => setTab("games")}
            className={`rounded border px-2 py-0.5 ${
              tab === "games"
                ? "border-brass bg-panel text-brass"
                : "border-edge bg-panel-raised text-ink-soft hover:border-brass"
            }`}
          >
            Games
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "settings"}
            data-testid="game-picker-tab-settings"
            onClick={() => setTab("settings")}
            className={`rounded border px-2 py-0.5 ${
              tab === "settings"
                ? "border-brass bg-panel text-brass"
                : "border-edge bg-panel-raised text-ink-soft hover:border-brass"
            }`}
          >
            This game
          </button>
        </div>
      ) : null}

      {tab === "settings" && currentGame ? (
        <div data-testid="game-settings-panel">
          <dl className="flex flex-col gap-1">
            {isRenaming ? (
              <div className="flex flex-col gap-1">
                <dt className="text-ink-soft">Name</dt>
                <dd className="flex flex-col gap-1">
                  <input
                    ref={renameInputRef}
                    data-testid="game-rename-input"
                    aria-label="game name"
                    value={renaming ?? ""}
                    disabled={busy}
                    autoFocus
                    onChange={(event) => {
                      setRenaming(event.target.value);
                      setRenameError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveRename();
                      }
                      if (event.key === "Escape") {
                        // Stop the *React* event here, before it reaches the picker's own
                        // `document` Escape listener (React dispatches from the root container,
                        // below `document` in the bubble path) - otherwise cancelling the edit
                        // also closes the whole picker.
                        event.stopPropagation();
                        cancelRename();
                      }
                    }}
                    className="rounded border border-edge bg-panel px-2 py-1 text-ink disabled:opacity-50"
                  />
                  {renameError ? (
                    <p data-testid="game-rename-error" role="alert" className="text-danger">
                      {renameError}
                    </p>
                  ) : null}
                  {duplicate ? (
                    <p data-testid="game-rename-warning" className="text-warn">
                      Another game is already called “{duplicate}”.
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      data-testid="game-rename-save"
                      disabled={busy}
                      onClick={() => void saveRename()}
                      className="rounded border border-brass px-2 py-0.5 text-brass disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      data-testid="game-rename-cancel"
                      disabled={busy}
                      onClick={cancelRename}
                      className="rounded border border-edge px-2 py-0.5 text-ink disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </dd>
              </div>
            ) : (
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-ink-soft">Name</dt>
                <dd className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-ink">{currentGame.metadata.gameName}</span>
                  <button
                    type="button"
                    ref={renameLinkRef}
                    data-testid="rename-game"
                    disabled={busy}
                    onClick={() => {
                      setRenaming(currentGame.metadata.gameName);
                      setRenameError(null);
                    }}
                    className="text-brass hover:underline disabled:opacity-50"
                  >
                    Rename
                  </button>
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-soft">Ruleset</dt>
              <dd className="text-ink">{currentGame.metadata.rulesetId}</dd>
            </div>
          </dl>

          <div className="mt-2 border-t border-edge pt-2">
            <button
              type="button"
              data-testid="export-game"
              disabled={busy || isRenaming}
              onClick={() => onExport(currentGame.metadata.gameId)}
              className="w-full rounded border border-edge bg-panel px-2 py-1 text-left text-brass hover:border-brass disabled:opacity-50"
            >
              Export game backup…
            </button>
            <button
              ref={importButtonRef}
              type="button"
              data-testid="import-game"
              disabled={busy || isRenaming}
              onClick={() => importRef.current?.click()}
              className="mt-1.5 w-full rounded border border-edge bg-panel px-2 py-1 text-left text-brass hover:border-brass disabled:opacity-50"
            >
              Import game backup…
            </button>
            <input
              ref={importRef}
              data-testid="import-game-input"
              type="file"
              accept=".json"
              className="hidden"
              onChange={onPickImport}
            />
            {pendingImport ? (
              <div data-testid="game-import-confirm" className="mt-1.5 rounded border border-danger/40 p-1.5">
                <p className="text-ink-soft">
                  “{pendingImport.gameName}” is already here. Replace it with the backup, or import the
                  backup as a second game?
                </p>
                <p className="mt-1 text-ink-soft">Replacing erases its current turns, orders and remembered map.</p>
                <div className="mt-1.5 flex justify-end gap-1.5">
                  <button
                    type="button"
                    data-testid="game-import-replace"
                    disabled={busy}
                    onClick={() => {
                      onImport(pendingImport.file, "replace");
                      setPendingImport(null);
                    }}
                    className="rounded border border-danger px-2 py-0.5 text-danger disabled:opacity-50"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    data-testid="game-import-keep-both"
                    disabled={busy}
                    onClick={() => {
                      onImport(pendingImport.file, "copy");
                      setPendingImport(null);
                    }}
                    className="rounded border border-brass px-2 py-0.5 text-brass disabled:opacity-50"
                  >
                    Keep both
                  </button>
                  <button
                    type="button"
                    data-testid="game-import-cancel"
                    autoFocus
                    onClick={() => {
                      setPendingImport(null);
                      importButtonRef.current?.focus();
                    }}
                    className="rounded border border-edge px-2 py-0.5 text-ink"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-ink-soft">
                Import creates a new game; if it is already here you are asked whether to replace it.
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <ul className="flex flex-col">
            {sorted.map((game) => {
              const gameId = game.metadata.gameId;
              const current = gameId === currentGameId;

              return (
                <li key={gameId} data-testid={`game-row-${gameId}`} data-current={current}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onOpen(gameId)}
                      className={`flex-1 truncate rounded px-1.5 py-1 text-left disabled:opacity-50 ${
                        current ? "text-brass" : "text-ink hover:bg-panel"
                      }`}
                    >
                      <span aria-hidden>{current ? "● " : "○ "}</span>
                      {game.metadata.gameName}
                    </button>
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) {
                          removeButtons.current.set(gameId, element);
                        } else {
                          removeButtons.current.delete(gameId);
                        }
                      }}
                      disabled={busy}
                      aria-label={`remove ${game.metadata.gameName}`}
                      onClick={() => {
                        setRemovalFailure(null);
                        setConfirmingRemovalOf(gameId);
                      }}
                      className="rounded px-1.5 py-1 text-ink-dim hover:text-danger disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>

                  {confirmingRemovalOf === gameId ? (
                    (() => {
                      // One reading of the failure state for this row, so the message shown and the
                      // action Try again repeats can never come from different rows.
                      const failed = removalFailure?.gameId === gameId ? removalFailure : null;
                      return (
                        <RemoveGameConfirm
                          gameId={gameId}
                          gameName={game.metadata.gameName}
                          busy={busy}
                          failure={failed?.message ?? null}
                          onDelete={() => void removeGame(gameId, game.metadata.gameName, "delete")}
                          onReset={() => void removeGame(gameId, game.metadata.gameName, "reset")}
                          onRetry={() => {
                            if (failed) {
                              void removeGame(gameId, game.metadata.gameName, failed.action);
                            }
                          }}
                          onCancel={() => closeRemoval(gameId)}
                        />
                      );
                    })()
                  ) : null}
                </li>
              );
            })}
          </ul>

          <div className="mt-1.5 border-t border-edge pt-1.5">
            {creating ? (
              <GameForm busy={busy} error={error} onCreate={onCreate} />
            ) : (
              <button
                type="button"
                data-testid="new-game"
                disabled={busy}
                onClick={() => setCreating(true)}
                className="w-full rounded px-1.5 py-1 text-left text-brass hover:bg-panel disabled:opacity-50"
              >
                + New game…
              </button>
            )}
          </div>
        </>
      )}

      {error && !creating ? (
        <p data-testid="game-picker-error" role="alert" className="mt-1.5 text-danger">
          {error}
        </p>
      ) : null}
    </PopoverFrame>
  );
}
