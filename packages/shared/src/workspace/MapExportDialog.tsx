import { useState } from "react";
import type { MapExportContent } from "@atlantis/core-client";
import { cornerValue, DEFAULT_EXPORT_CONTENT, exportSummary } from "../mapExport";
import { useEscapeToDismiss } from "./dismissLayer";
import { hexesInRect, type MapRect } from "./mapMarquee";
import type { HexNode } from "../hexMapModel";

/**
 * What to send an ally, and how much of it.
 *
 * The rectangle arrives from a Shift+drag on the map, but the four corners are editable here as
 * well - a drag is quick and imprecise, the keyboard cannot drag at all, and a player who wants
 * exactly the province they can name should not have to aim for it.
 *
 * The three content switches are the point of the dialog. Everything is shared by default because
 * that is the usual answer to an ally who asked for a map; withholding is the deliberate act, and
 * the count under the fields says how much is going either way.
 */
export function MapExportDialog({
  hexes,
  level,
  rect,
  busy,
  error,
  onExport,
  onDismiss
}: {
  hexes: HexNode[];
  level: number;
  /** The dragged rectangle, or the bounds of everything known when nothing was dragged. */
  rect: MapRect;
  busy: boolean;
  error: string | null;
  onExport: (rect: MapRect, content: MapExportContent) => void;
  onDismiss: () => void;
}) {
  const [bounds, setBounds] = useState<MapRect>(rect);
  const [content, setContent] = useState<MapExportContent>(DEFAULT_EXPORT_CONTENT);

  useEscapeToDismiss(onDismiss);

  const regions = hexesInRect(hexes, bounds, level);
  const corner = (key: keyof MapRect, label: string) => (
    <label className="flex items-center gap-1 text-ink-soft">
      <span className="w-6 text-[10px] uppercase tracking-wide text-ink-dim">{label}</span>
      <input
        type="number"
        data-testid={`map-export-${key}`}
        aria-label={label}
        value={bounds[key]}
        onChange={(event) => {
          // A field mid-edit is not a coordinate yet; the corner stays where it was until it is
          // one. See `cornerValue`.
          const value = cornerValue(event.target.value);
          if (value !== null) {
            setBounds({ ...bounds, [key]: value });
          }
        }}
        className="w-16 rounded border border-edge bg-panel px-1 py-0.5 text-ink"
      />
    </label>
  );

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

        <p className="text-[10px] text-ink-dim">
          Shift-drag on the map to pick an area, or set the corners here. Level {level}.
        </p>

        <div className="flex flex-wrap gap-2">
          {corner("fromX", "x from")}
          {corner("toX", "x to")}
          {corner("fromY", "y from")}
          {corner("toY", "y to")}
        </div>

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
