import { useEffect, useRef } from "react";
import type { DeclaredAttitudes, FactionStatus } from "@atlantis/core-client";
import { allowanceRows, attitudeLines } from "./factionView";

/**
 * Everything the report says about the faction as a whole: allowances, unclaimed silver and the
 * attitudes declared toward every other faction.
 *
 * A popover anchored off the faction name in the header, in the shape `MergedFactionsPanel` and
 * `TurnMessagesPanel` already use - this is read occasionally, not watched while planning, so a
 * sixth dock panel would cost permanent map space for something opened rarely.
 */
export function FactionPanel({
  factionName,
  factionId,
  factionTypes,
  unclaimedSilver,
  status,
  attitudes,
  mergedFactionIds,
  onDismiss
}: {
  factionName: string | null;
  factionId: string | null;
  factionTypes: string[];
  unclaimedSilver: number | null;
  status: FactionStatus | null;
  attitudes: DeclaredAttitudes | null;
  mergedFactionIds: ReadonlySet<string>;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    // The wrapper rather than the panel, for the reason `MergedFactionsPanel` gives: the chip that
    // opened this sits beside it in that wrapper, and testing the panel alone would dismiss on the
    // chip's own press and let its toggle reopen immediately.
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

  const rows = status ? allowanceRows(status) : [];
  const lines = attitudes ? attitudeLines(attitudes, mergedFactionIds) : [];
  const unparsed = status?.unparsed ?? [];

  return (
    <div
      ref={panelRef}
      data-testid="faction-panel"
      role="dialog"
      aria-label="Faction"
      // The header is the drop target for report files; without this the panel becomes a second,
      // invisible one that exists only while it happens to be open. `MergedFactionsPanel` and
      // `TurnMessagesPanel` do the same.
      onDragOver={(event) => event.stopPropagation()}
      // `whitespace-normal` undoes the header's `whitespace-nowrap`, which a child inherits - the
      // longest attitude line here is thirteen names long.
      className="absolute left-0 top-full z-20 mt-1 w-80 rounded border border-edge bg-panel-raised text-[11.5px] whitespace-normal shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink">
          {factionName ?? "Unnamed faction"}
          {factionId ? <span className="text-ink-dim"> ({factionId})</span> : null}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="close faction view"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[40vh] overflow-y-auto p-2">
        {factionTypes.length > 0 ? (
          <p className="text-ink-soft">{factionTypes.join(", ")}</p>
        ) : null}

        {unclaimedSilver !== null ? (
          <p className="mt-1">
            <span className="text-ink-soft">Unclaimed silver </span>
            <span className="text-ink">{unclaimedSilver}</span>
          </p>
        ) : null}

        {rows.length > 0 ? (
          <div className="mt-2">
            <div className="text-brass">Allowances</div>
            <div className="mt-1 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0.5">
              {rows.map((row) => (
                <div key={row.label} className="contents">
                  <span className="text-ink-soft">{row.label}</span>
                  <span className="block h-1 rounded bg-edge-soft">
                    <span
                      className={`block h-full rounded ${row.atCeiling ? "bg-brass" : "bg-select"}`}
                      style={{ width: `${Math.min(row.fraction, 1) * 100}%` }}
                    />
                  </span>
                  <span className={row.atCeiling ? "text-brass-bright" : "text-ink"}>
                    {row.used} / {row.maximum}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {lines.length > 0 ? (
          <div className="mt-2">
            <div className="text-brass">
              Declared attitudes
              {attitudes?.defaultAttitude ? (
                <span className="text-ink-dim"> · default {attitudes.defaultAttitude}</span>
              ) : null}
            </div>
            <div className="mt-1 grid gap-1">
              {lines.map((line) => (
                <div key={line.attitude} data-testid={`faction-attitude-${line.attitude}`}>
                  <span className="text-ink-soft">{line.attitude}: </span>
                  {line.factions.length > 0 ? (
                    <span className="text-ink">
                      {line.factions.map((faction, index) => (
                        <span key={faction.id}>
                          {index > 0 ? ", " : ""}
                          <span
                            data-testid={`faction-attitude-name-${faction.id}`}
                            className={faction.merged ? "text-brass-bright" : undefined}
                          >
                            {faction.name} ({faction.id})
                            {faction.merged ? " ⌂" : ""}
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-ink-dim italic">none declared</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {unparsed.length > 0 ? (
          <p className="mt-2 border-t border-edge pt-1.5 text-ink-dim">{unparsed.join(" · ")}</p>
        ) : null}
      </div>
    </div>
  );
}
