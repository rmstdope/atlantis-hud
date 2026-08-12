import { useState } from "react";
import type { MapExportContent } from "@atlantis/core-client";
import { DEFAULT_EXPORT_CONTENT, exportAreaSummary, exportSummary } from "../mapExport";
import { useEscapeToDismiss } from "./dismissLayer";
import { boundsOfKnown, hexesInRect, type MapRect } from "./mapMarquee";
import type { HexNode } from "../hexMapModel";

/**
 * What to send an ally, and how much of it.
 *
 * The area is stated rather than edited. It comes from a Shift+drag the player has already seen on
 * the map, or - when they did not drag - from everything known on this level, which is worth
 * saying in words. Coordinate fields here asked the player to check arithmetic they never did, and
 * put a second, editable answer beside the one the map had already given them.
 *
 * The three content switches are the point of the dialog. Everything is shared by default because
 * that is the usual answer to an ally who asked for a map; withholding is the deliberate act, and
 * the count under the switches says how much is going either way.
 */
export function MapExportDialog({
  hexes,
  level,
  selection,
  busy,
  error,
  onExport,
  onDismiss
}: {
  hexes: HexNode[];
  level: number;
  /** The rectangle a Shift+drag left behind, or nothing when the whole level is going. */
  selection: MapRect | null;
  busy: boolean;
  error: string | null;
  onExport: (rect: MapRect, content: MapExportContent) => void;
  onDismiss: () => void;
}) {
  const [content, setContent] = useState<MapExportContent>(DEFAULT_EXPORT_CONTENT);

  useEscapeToDismiss(onDismiss);

  // Everything known on the level, when no area was picked. A level holding nothing visited leaves
  // a rectangle covering one hex at the origin, which the count below correctly calls empty.
  const bounds = selection ?? boundsOfKnown(hexes, level) ?? EMPTY;
  const regions = hexesInRect(hexes, bounds, level);

  const toggle = (key: keyof MapExportContent, label: string, description: string) => (
    <label className="flex items-center justify-between gap-2 text-ink-soft">
      <span>
        <span className="block">{label}</span>
        <span className="block text-[10px] text-ink-dim">{description}</span>
      </span>
      <input
        type="checkbox"
        data-testid={`map-export-${key}`}
        aria-label={label}
        checked={content[key]}
        onChange={(event) => setContent({ ...content, [key]: event.target.checked })}
        className="accent-brass"
      />
    </label>
  );

  return (
    <div
      data-testid="map-export-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss();
        }
      }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50"
    >
      <div
        data-testid="map-export-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Export map"
        className="flex w-[26rem] flex-col gap-2 rounded border border-edge bg-panel-raised p-3 text-[11.5px] whitespace-normal shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-ink">Export map</h2>
          <button
            type="button"
            data-testid="map-export-close"
            aria-label="close export"
            autoFocus
            onClick={onDismiss}
            className="rounded border border-edge px-1.5 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            ×
          </button>
        </div>

        <p data-testid="map-export-area" className="text-ink">
          {exportAreaSummary(selection)}
        </p>
        <p className="text-[10px] text-ink-dim">
          Shift-drag on the map to export part of it instead.
        </p>

        <div className="flex flex-col gap-1.5 border-t border-edge pt-2">
          {toggle("structures", "Structures", "Buildings, ships and roads.")}
          {toggle("units", "Units", "Yours and everyone else's, as your reports saw them.")}
          {toggle(
            "advancedResources",
            "Advanced resources",
            "Mithril, ironwood and the rest. Ordinary products are always included."
          )}
        </div>

        <p data-testid="map-export-summary" className="text-ink-soft">
          {exportSummary(regions)}
        </p>
        {error ? (
          <p data-testid="map-export-error" className="text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded border border-edge px-2 py-0.5 text-ink-soft hover:border-brass hover:text-brass"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="map-export-confirm"
            // A file with no regions in it is a file the player would send and the ally would
            // wonder about, so the button that writes one is not available.
            disabled={busy || regions === 0}
            onClick={() => onExport(bounds, content)}
            className="rounded border border-brass px-2 py-0.5 text-brass hover:bg-brass/10 disabled:border-edge disabled:text-ink-dim"
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A level with nothing visited on it: one hex at the origin, which holds no regions. */
const EMPTY: MapRect = { fromX: 0, fromY: 0, toX: 0, toY: 0 };
