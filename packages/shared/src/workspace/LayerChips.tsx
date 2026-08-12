import { useState } from "react";
import { useWorkspaceStore, type LayerName } from "../workspaceStore";
import { BadgeMenu } from "./BadgeMenu";

/**
 * Layer toggles above the map.
 *
 * Every toggle here drives the map. Trade routes used to sit alongside them with nothing behind
 * it, waiting for a feature that never came; a control that does nothing is worse than no
 * control, so it went the way inert controls should.
 *
 * Two of them have since gone the other way. "Units" and "structures" each spoke for a whole
 * family of marks, so hiding the buildings on a crowded level also took the ships, the shafts,
 * the lairs and the roads; each mark now has a toggle of its own, and they live behind the Badges
 * chip because ten of them will not fit in a strip that shares the map's top band with the zoom
 * cluster. What is left here is what is not a badge.
 */
const LAYERS: Array<{ name: LayerName; label: string }> = [
  { name: "staleness", label: "Staleness" },
  { name: "movement", label: "Movement" }
];

export function LayerChips({ levels }: { levels: number[] }) {
  const layers = useWorkspaceStore((state) => state.layers);
  const toggleLayer = useWorkspaceStore((state) => state.toggleLayer);
  const badges = useWorkspaceStore((state) => state.badges);
  const toggleBadge = useWorkspaceStore((state) => state.toggleBadge);
  const setAllBadges = useWorkspaceStore((state) => state.setAllBadges);
  const level = useWorkspaceStore((state) => state.level);
  const setLevel = useWorkspaceStore((state) => state.setLevel);
  const [badgesOpen, setBadgesOpen] = useState(false);

  return (
    <div
      data-testid="layer-chips"
      className="pointer-events-auto flex items-center gap-1.5 rounded-md border border-edge bg-panel/95 px-2 py-1 shadow-lg backdrop-blur"
    >
      {LAYERS.map(({ name, label }) => (
        <label
          key={name}
          className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] ${
            layers[name] ? "border-select bg-select/15 text-ink" : "border-edge text-ink-dim"
          }`}
        >
          <input
            type="checkbox"
            checked={layers[name]}
            onChange={() => toggleLayer(name)}
            className="h-3 w-3 accent-select"
          />
          {label}
        </label>
      ))}

      <div className="relative">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={badgesOpen}
          onClick={() => setBadgesOpen((open) => !open)}
          className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
            // Lit while any badge is off, so a hex missing a mark is never a mystery: the strip
            // says the map is showing less than everything without the panel being open.
            Object.values(badges).every(Boolean)
              ? "border-edge text-ink-dim"
              : "border-select bg-select/15 text-ink"
          }`}
        >
          Badges ▾
        </button>
        {badgesOpen && (
          <BadgeMenu
            badges={badges}
            onToggle={toggleBadge}
            onSetAll={setAllBadges}
            onDismiss={() => setBadgesOpen(false)}
          />
        )}
      </div>

      {levels.length > 1 ? (
        <select
          value={level}
          onChange={(event) => setLevel(Number(event.target.value))}
          aria-label="Map level"
          className="rounded border border-edge bg-panel-raised px-2 py-0.5 text-[11px] text-ink"
        >
          {levels.map((candidate) => (
            <option key={candidate} value={candidate}>
              {candidate === 1 ? "surface" : `level ${candidate}`}
            </option>
          ))}
        </select>
      ) : (
        <span className="px-2 py-0.5 text-[11px] text-ink-dim">surface</span>
      )}
    </div>
  );
}
