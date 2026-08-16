import type { MergedReportRecord } from "@atlantis/core-client";
import { POPOVER_BODY_MAX_H } from "./primitives";
import { PopoverFrame } from "./popover";

/**
 * Whose eyes the map is showing.
 *
 * Merging an ally's report (issue #53) writes their regions under the player's own faction, so the
 * map quietly gets bigger and the header goes on saying the same faction it said before. That is
 * exactly what the player asked for, and it leaves them with no way to answer "where did these
 * hexes come from" - least of all after a reload, when even the status line that reported the merge
 * is gone.
 *
 * A panel under a chip beside the faction, in the shape `TurnMessagesPanel` already uses: this is a
 * short list read occasionally, and darkening the workspace for it would be out of proportion.
 */
export function MergedFactionsPanel({
  turnLabel,
  merged,
  onDismiss
}: {
  turnLabel: string | null;
  merged: MergedReportRecord[];
  onDismiss: () => void;
}) {
  return (
    <PopoverFrame testId="merged-factions" label="Merged reports" align="left" width="w-72">
      <div className="flex items-center gap-2 border-b border-edge px-2 py-1.5">
        <span className="text-ink-soft">
          {turnLabel ? `Merged into turn ${turnLabel}` : "Merged into this turn"}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="close merged reports"
          onClick={onDismiss}
          className="rounded px-1.5 text-ink-dim hover:text-ink"
        >
          ✕
        </button>
      </div>

      <ul className={`${POPOVER_BODY_MAX_H} overflow-y-auto p-2`}>
        {merged.map((record) => (
          <li
            key={record.mergedFactionId}
            data-testid={`merged-faction-${record.mergedFactionId}`}
            className="border-t border-edge-soft py-1 text-ink first:border-t-0"
          >
            {record.mergedFactionName} ({record.mergedFactionId})
            <span className="text-ink-dim"> · turn {record.turnNumber}</span>
          </li>
        ))}
      </ul>

      <p className="border-t border-edge px-2 py-1.5 text-ink-dim">
        What these factions saw is on your map. Their units are shown, and cannot be ordered.
      </p>
    </PopoverFrame>
  );
}
