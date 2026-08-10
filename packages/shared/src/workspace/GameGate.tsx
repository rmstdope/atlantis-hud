import type { ChangeEvent, ReactNode } from "react";
import { useRef } from "react";
import { GameForm } from "./GameForm";

/**
 * What the application is before it has a game.
 *
 * The workspace is not rendered at all here, rather than rendered inert. Everything it offers -
 * loading a report, editing orders, remembering a map - has to land in some game's database, so
 * with no game there is nothing for any of it to do, and a screen full of disabled controls only
 * invites the player to work out which one is the way in.
 */
export function GameGate({
  platformLabel,
  busy,
  error,
  onCreate,
  onImport,
  settingsOpen,
  onToggleSettings,
  settings
}: {
  platformLabel: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string, rulesetId: string) => void;
  onImport: (file: File) => void;
  /**
   * Settings are reachable here too, before any game exists. Asking which version you are running,
   * or whether a newer one has been published, is not a question that should require having created
   * a game first - and on first run this screen is the whole application.
   */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  settings: ReactNode;
}) {
  const importRef = useRef<HTMLInputElement | null>(null);
  const onPickImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImport(file);
    }
    event.target.value = "";
  };

  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      <header className="flex h-9 flex-none items-center gap-3.5 border-b border-edge bg-panel px-3 text-[11.5px] whitespace-nowrap">
        <span className="tracking-[0.06em] text-brass">ATLANTIS HUD</span>
        <span className="text-ink-soft">{platformLabel}</span>
        <span className="flex-1" />
        <span className="relative">
          <button
            type="button"
            data-testid="settings-indicator"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-label="Settings"
            onClick={onToggleSettings}
            className="rounded border border-edge bg-panel-raised px-2 py-1 text-ink-soft hover:border-brass hover:text-ink"
          >
            <span aria-hidden>⚙</span>
          </button>
          {settingsOpen ? settings : null}
        </span>
      </header>

      <main
        data-testid="game-gate"
        className="flex min-h-0 flex-1 items-center justify-center p-6"
      >
        <div className="w-72 rounded border border-edge bg-panel-raised p-4">
          <h1 className="mb-1 text-[13px] text-ink">No game yet</h1>
          <p className="mb-3 text-[11.5px] text-ink-soft">
            Every turn you load belongs to a game. Name one to begin.
          </p>
          <GameForm busy={busy} error={error} onCreate={onCreate} />
          <div className="mt-2 border-t border-edge pt-2">
            <button
              type="button"
              data-testid="game-gate-import"
              disabled={busy}
              onClick={() => importRef.current?.click()}
              className="w-full rounded border border-edge px-2.5 py-1 text-left text-brass disabled:opacity-50"
            >
              Import game backup…
            </button>
            <input
              ref={importRef}
              data-testid="game-gate-import-input"
              type="file"
              accept=".json"
              className="hidden"
              onChange={onPickImport}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
