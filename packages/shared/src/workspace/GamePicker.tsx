import type { GameManifest } from "@atlantis/core-client";
import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { BackupImportMode } from "../gameBackup";
import { backupGameIdentity } from "../gameBackup";
import { GameForm } from "./GameForm";

/**
 * The games the player has, and what can be done with them.
 *
 * A panel anchored under the header indicator rather than a centred modal: switching games is a
 * small, frequent act, and darkening the whole workspace to ask which of two names you meant is
 * more ceremony than the question deserves. It closes on Escape and on a click elsewhere, which is
 * what a player expects of something that opened under the thing they pressed.
 *
 * Deleting asks first, inline, and says what is lost. There is no undo anywhere in this
 * application, and a game holds a season of turns.
 *
 * Importing a backup of a game that is already here asks the same way (ah-c0m) - Replace, Keep
 * both, or Cancel - and says what replacing erases.
 */
export function GamePicker({
  games,
  currentGameId,
  busy,
  error,
  onOpen,
  onCreate,
  onDelete,
  onExport,
  onImport,
  onDismiss
}: {
  games: GameManifest[];
  currentGameId: string | null;
  busy: boolean;
  error: string | null;
  onOpen: (gameId: string) => void;
  onCreate: (name: string, rulesetId: string) => void;
  onDelete: (gameId: string) => void;
  onExport: (gameId: string) => void;
  onImport: (file: File, mode: BackupImportMode) => void;
  onDismiss: () => void;
}) {
  const [creating, setCreating] = useState(games.length === 0);
  const [confirmingDeleteOf, setConfirmingDeleteOf] = useState<string | null>(null);
  const [tab, setTab] = useState<"games" | "settings">("games");
  const [pendingImport, setPendingImport] = useState<{ file: File; gameName: string } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const importButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    // Pointer rather than click: a click that started inside and ended outside is still a drag
    // within the panel, not a dismissal.
    //
    // The wrapper rather than the panel, because the indicator that opened this sits beside it
    // inside that wrapper. Testing the panel alone dismisses on the indicator's own press, and the
    // button's toggle then reopens it - leaving a control that can only ever open the picker.
    const onPointerDown = (event: PointerEvent) => {
      const trigger = panelRef.current?.parentElement ?? panelRef.current;
      if (!trigger?.contains(event.target as Node)) {
        onDismiss();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onDismiss]);

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
    <div
      ref={panelRef}
      data-testid="game-picker"
      role="dialog"
      aria-label="Games"
      // The header is the drop target for report files, so a panel hanging off it must not swallow
      // a drag that was meant for the header underneath.
      onDragOver={(event) => event.stopPropagation()}
      // `whitespace-normal` undoes the header's `whitespace-nowrap`, which keeps the turn and
      // faction labels on one line up there and inherits into anything rendered inside it. The
      // delete confirmation is prose and has to wrap, or it runs off the side of this panel.
      className="absolute left-0 top-full z-20 mt-1 w-72 rounded border border-edge bg-panel-raised p-2 text-[11.5px] whitespace-normal shadow-lg"
    >
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
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-soft">Name</dt>
              <dd className="truncate text-ink">{currentGame.metadata.gameName}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="text-ink-soft">Ruleset</dt>
              <dd className="text-ink">{currentGame.metadata.rulesetId}</dd>
            </div>
          </dl>

          <div className="mt-2 border-t border-edge pt-2">
            <button
              type="button"
              data-testid="export-game"
              disabled={busy}
              onClick={() => onExport(currentGame.metadata.gameId)}
              className="w-full rounded border border-edge bg-panel px-2 py-1 text-left text-brass hover:border-brass disabled:opacity-50"
            >
              Export game backup…
            </button>
            <button
              ref={importButtonRef}
              type="button"
              data-testid="import-game"
              disabled={busy}
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
                      disabled={busy}
                      aria-label={`delete ${game.metadata.gameName}`}
                      onClick={() => setConfirmingDeleteOf(gameId)}
                      className="rounded px-1.5 py-1 text-ink-dim hover:text-danger disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>

                  {confirmingDeleteOf === gameId ? (
                    <div
                      data-testid={`game-delete-confirm-${gameId}`}
                      className="mt-1 rounded border border-danger/40 p-1.5"
                    >
                      <p className="text-ink-soft">
                        Delete “{game.metadata.gameName}”? Its turns, orders and remembered map are
                        erased.
                      </p>
                      <div className="mt-1.5 flex justify-end gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => onDelete(gameId)}
                          className="rounded border border-danger px-2 py-0.5 text-danger disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteOf(null)}
                          className="rounded border border-edge px-2 py-0.5 text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
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
    </div>
  );
}
