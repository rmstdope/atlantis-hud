import type { ChangeEvent, DragEvent } from "react";
import { useRef } from "react";

export type ImportStatus = {
  regionCount: number;
  unitCount: number;
  errorCount: number;
  message: string | null;
  failed: boolean;
};

type AppHeaderProps = {
  platformLabel: string;
  gameName: string | null;
  factionLabel: string | null;
  turnLabel: string | null;
  status: ImportStatus | null;
  busy: boolean;
  onLoadReport: (text: string, fileName: string) => void;
  onExportOrders: () => void;
  canExport: boolean;
};

/**
 * Game, turn and faction, with report state alongside them.
 *
 * Report loading lives here rather than in a panel of its own: it is something you do occasionally
 * and then want out of the way, and putting it in the header means it costs no map area at all.
 */
export function AppHeader({
  platformLabel,
  gameName,
  factionLabel,
  turnLabel,
  status,
  busy,
  onLoadReport,
  onExportOrders,
  canExport
}: AppHeaderProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const readFile = async (file: File) => {
    onLoadReport(await file.text(), file.name);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      void readFile(file);
    }
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void readFile(file);
    }
    // Cleared so choosing the same file twice still fires a change.
    event.target.value = "";
  };

  return (
    <header
      data-testid="app-header"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex h-9 flex-none items-center gap-3.5 border-b border-edge bg-panel px-3 text-[11.5px] whitespace-nowrap"
    >
      <span className="tracking-[0.06em] text-brass">ATLANTIS HUD</span>
      <span className="text-ink-soft">{platformLabel}</span>

      {gameName ? <span className="text-ink">{gameName}</span> : null}
      {turnLabel ? (
        <span className="text-ink-soft">
          Turn <span className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-ink">{turnLabel}</span>
        </span>
      ) : null}
      {factionLabel ? (
        <span className="text-ink-soft">
          Faction <span className="text-ink">{factionLabel}</span>
        </span>
      ) : null}

      <span data-testid="import-status" className="flex items-center gap-1.5 text-ink-soft">
        {status ? (
          <>
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                status.failed ? "bg-danger" : status.errorCount > 0 ? "bg-warn" : "bg-ok"
              }`}
            />
            {status.message ??
              `${status.regionCount} region${status.regionCount === 1 ? "" : "s"} · ${status.unitCount} unit${status.unitCount === 1 ? "" : "s"}${status.errorCount > 0 ? ` · ${status.errorCount} turn error${status.errorCount === 1 ? "" : "s"}` : ""}`}
          </>
        ) : (
          <span className="text-ink-dim">no report loaded</span>
        )}
      </span>

      <span className="flex-1" />

      <input
        ref={fileRef}
        type="file"
        accept=".rep,.txt,.report,text/plain"
        onChange={onPick}
        className="hidden"
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="rounded border border-brass px-2.5 py-1 text-brass disabled:opacity-50"
      >
        {busy ? "Loading…" : "Load report…"}
      </button>
      <button
        type="button"
        disabled={!canExport}
        onClick={onExportOrders}
        className="rounded border border-edge bg-panel-raised px-2.5 py-1 text-ink disabled:opacity-40"
      >
        Export orders
      </button>
    </header>
  );
}
