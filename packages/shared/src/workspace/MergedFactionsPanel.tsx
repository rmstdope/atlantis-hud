import { useEffect, useRef } from "react";
import type { MergedReportRecord } from "@atlantis/core-client";
import { POPOVER_BODY_MAX_H } from "./primitives";

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
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    // The wrapper rather than the panel, for the reason `TurnMessagesPanel` gives: the chip that
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

  return (
    <div
      ref={panelRef}
      data-testid="merged-factions"
      role="dialog"
      aria-label="Merged reports"
      // Not a drop target: this floats over the map but is a child of the header, which is what
      // accepts a dropped report. Left alone it would become a second, invisible drop zone that
      // exists only while this happens to be open. The other header panels do the same.
      onDragOver={(event) => event.stopPropagation()}
      // `whitespace-normal` undoes the header's `whitespace-nowrap`, which inherits into anything
      // rendered inside it.
      className="absolute left-0 top-full z-20 mt-1 w-72 rounded border border-edge bg-panel-raised text-[11.5px] whitespace-normal shadow-lg"
    >
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
    </div>
  );
}
