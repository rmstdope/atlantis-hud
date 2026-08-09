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
  onCreate
}: {
  platformLabel: string;
  busy: boolean;
  error: string | null;
  onCreate: (name: string, rulesetId: string) => void;
}) {
  return (
    <div className="flex h-full flex-col bg-ground text-ink">
      <header className="flex h-9 flex-none items-center gap-3.5 border-b border-edge bg-panel px-3 text-[11.5px] whitespace-nowrap">
        <span className="tracking-[0.06em] text-brass">ATLANTIS HUD</span>
        <span className="text-ink-soft">{platformLabel}</span>
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
        </div>
      </main>
    </div>
  );
}
