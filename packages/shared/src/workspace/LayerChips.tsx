import { useWorkspaceStore, type LayerName } from "../workspaceStore";

/**
 * Layer toggles above the map.
 *
 * Every toggle here drives the map. Trade routes used to sit alongside them with nothing behind
 * it, waiting for a feature that never came; a control that does nothing is worse than no
 * control, so it went the way inert controls should.
 *
 * Structures joined the working ones in #58: the map draws a marker on a hex that holds any, so
 * leaving the toggle inert would have made it a control that visibly lies.
 */
const LAYERS: Array<{ name: LayerName; label: string }> = [
  { name: "units", label: "Units" },
  { name: "structures", label: "Structures" },
  { name: "staleness", label: "Staleness" },
  { name: "movement", label: "Movement" }
];

export function LayerChips({ levels }: { levels: number[] }) {
  const layers = useWorkspaceStore((state) => state.layers);
  const toggleLayer = useWorkspaceStore((state) => state.toggleLayer);
  const level = useWorkspaceStore((state) => state.level);
  const setLevel = useWorkspaceStore((state) => state.setLevel);

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
