import { useState, type ReactNode } from "react";
import { useWorkspaceStore } from "../workspaceStore";
import { BadgeMenu } from "./BadgeMenu";
import { ChipPopover } from "./popover";

/**
 * The controls that act on the map view, in the strip above the map: the badge menu and the three
 * zoom buttons.
 *
 * Staleness and movement used to sit here too. They are set once and then forgotten, so they moved
 * into Settings > Global beside the other display preferences and gave the band back to the map
 * (ah-l9mp). Badges did not: it is ten marks flicked *while reading* a crowded hex, and its chip
 * lights when any of them is off, so a hex missing a mark is never a mystery. Behind a dialog that
 * gesture becomes four, with the dialog over the hex being read.
 *
 * The level selector left too, for the opposite reason - it is changed often enough to want to be
 * visible without looking at the map's corner, so it is in the top bar.
 *
 * The zoom buttons joined it (ah-ljil), which is why a file that once held only chips is now named
 * for the view. They used to sit in the map's own top-right corner, so the controls that act on the
 * map view were split between two corners. They moved *here* rather than the chip moving *there*
 * because everything that protects this strip already lives on it and none of it had to be touched:
 * one element marked `data-map-overlay="top"` for zoom-to-fit to measure, one conditional lift to
 * `z-30` while a menu is open (ah-v09e), and one place inside the clickable top 48px of the map.
 * `zoomBy` and `frameAll` close over the map's own view state, so what crosses the boundary is the
 * two actions, through `MapCanvasHandle`, not the state behind them.
 */
export function MapViewControls({
  onZoomBy,
  onFrameAll
}: {
  /** Zoom about the centre of the map, in whole steps: positive in, negative out. */
  onZoomBy: (steps: number) => void;
  /** Frame every hex on the level into the strip of map the panes leave visible. */
  onFrameAll: () => void;
}) {
  const badges = useWorkspaceStore((state) => state.badges);
  const toggleBadge = useWorkspaceStore((state) => state.toggleBadge);
  const setAllBadges = useWorkspaceStore((state) => state.setAllBadges);
  const [badgesOpen, setBadgesOpen] = useState(false);
  const showingEverything = Object.values(badges).every(Boolean);

  return (
    <div
      data-testid="layer-chips"
      className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-edge bg-panel/95 px-2 py-1 shadow-lg backdrop-blur"
    >
      <ChipPopover
        open={badgesOpen}
        onDismiss={() => setBadgesOpen(false)}
        panel={<BadgeMenu badges={badges} onToggle={toggleBadge} onSetAll={setAllBadges} />}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={badgesOpen}
          // Lit while any badge is off, so a hex missing a mark is never a mystery: the strip says
          // the map is showing less than everything without the panel having to be open.
          data-badges-all={showingEverything}
          onClick={() => setBadgesOpen((open) => !open)}
          className={`flex items-center gap-1 rounded border px-2 py-0.5 text-pane ${
            showingEverything ? "border-edge text-ink-dim" : "border-select bg-select/15 text-ink"
          }`}
        >
          Badges
          {/* Decoration: read out, the caret becomes part of what a screen reader announces and
              part of what a role-and-name query has to match. Hidden, as every other popover
              trigger in this workspace hides its own. */}
          <span aria-hidden className="text-ink-dim">
            ▾
          </span>
        </button>
      </ChipPopover>

      <ZoomButton label="Zoom in" onClick={() => onZoomBy(1)}>
        +
      </ZoomButton>
      <ZoomButton label="Zoom out" onClick={() => onZoomBy(-1)}>
        −
      </ZoomButton>
      <ZoomButton label="Zoom to fit" onClick={onFrameAll}>
        ⤢
      </ZoomButton>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-7 w-7 rounded border border-edge bg-panel/95 text-ink-soft shadow hover:text-ink"
    >
      {children}
    </button>
  );
}
