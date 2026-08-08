import { useWorkspaceStore, type LayerName } from "../workspaceStore";

/**
 * Layer toggles above the map.
 *
 * Only staleness does anything so far; the rest are present and operable but have nothing behind
 * them yet, which is what the issue asks for. They start off rather than on, so an inert toggle
 * cannot be mistaken for one that is working.
 */
const LAYERS: Array<{ name: LayerName; label: string }> = [
  { name: "units", label: "Units" },
  { name: "structures", label: "Structures" },
  { name: "staleness", label: "Staleness" },
  { name: "tradeRoutes", label: "Trade routes" },
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
            className="h-3 w-3 accent-[#4a9fd8]"
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
