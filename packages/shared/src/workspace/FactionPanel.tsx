import type { ReactNode } from "react";
import type { DeclaredAttitudes, FactionStatus } from "@atlantis/core-client";
import { allowanceRows, attitudeLines } from "./factionView";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

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
  renderFactionName,
  onDismiss
}: {
  factionName: string | null;
  factionId: string | null;
  factionTypes: string[];
  unclaimedSilver: number | null;
  status: FactionStatus | null;
  attitudes: DeclaredAttitudes | null;
  mergedFactionIds: ReadonlySet<string>;
  /**
   * Wraps a named faction so it can open that faction's dossier beside itself (ah-bu2c). Left off,
   * the name prints as it always did - this panel has no idea what a dossier is, and does not need
   * the report to draw the attitudes list.
   */
  renderFactionName?: (factionId: string, label: ReactNode) => ReactNode;
  onDismiss: () => void;
}) {
  const rows = status ? allowanceRows(status) : [];
  const lines = attitudes ? attitudeLines(attitudes, mergedFactionIds) : [];
  const unparsed = status?.unparsed ?? [];

  return (
    <PopoverFrame testId="faction-panel" label="Faction" align="left" width="w-80">
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

      <div className={`${POPOVER_BODY_MAX_H} overflow-y-auto p-2`}>
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
                          {(() => {
                            const label = (
                              <span
                                data-testid={`faction-attitude-name-${faction.id}`}
                                className={faction.merged ? "text-brass-bright" : undefined}
                              >
                                {faction.name} ({faction.id})
                                {faction.merged ? " ⌂" : ""}
                              </span>
                            );
                            return renderFactionName ? renderFactionName(faction.id, label) : label;
                          })()}
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
    </PopoverFrame>
  );
}
