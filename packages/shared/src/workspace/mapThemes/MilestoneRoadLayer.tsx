import { useMemo } from "react";
import { radii } from "./geometry";
import type { LayerProps } from "./mapTheme";
import { roadNetwork } from "./milestoneRoads";

/** Widths as fractions of the hex radius, so a road shrinks with its hex as the roads always have. */
const CASING = radii(0.17);
const LINE = radii(0.07);
/** A road still being built: short dashes with round ends, read as dots. */
const DOTS = `${radii(0.01)} ${radii(0.12)}`;
const STONE = radii(0.07);
const STONE_OPEN = radii(0.06);
const STONE_RIM = radii(0.035);
const JUNCTION = radii(0.16);
const JUNCTION_CORE = radii(0.06);
const JUNCTION_RIM = radii(0.05);

/**
 * Roads drawn as a network for every theme: a slim line on a casing, a milestone where the road
 * crosses each hex edge, and a ringed disc at every junction. A milestone is filled when the road
 * carries on into the next hex and hollow when it stops there; a road still being built is dotted.
 * See `milestoneRoads.ts` for the shapes and the rule behind the milestones.
 */
export function MilestoneRoadLayer({ views }: LayerProps) {
  const network = useMemo(() => roadNetwork(views), [views]);
  if (network.pieces.length === 0) {
    return null;
  }
  return (
    <g pointerEvents="none" data-layer="roads">
      {network.pieces.map((piece, index) => (
        <path
          key={`casing-${index}`}
          d={piece.d}
          className="road-casing"
          strokeWidth={CASING}
          strokeDasharray={piece.unfinished ? DOTS : undefined}
        />
      ))}
      {network.pieces.map((piece, index) => (
        <path
          key={`line-${index}`}
          d={piece.d}
          className="road-line"
          strokeWidth={LINE}
          strokeDasharray={piece.unfinished ? DOTS : undefined}
          data-road={piece.unfinished ? "unfinished" : "built"}
        />
      ))}
      {network.milestones.map((stone) => (
        <circle
          key={`${stone.x},${stone.y}`}
          cx={stone.x}
          cy={stone.y}
          r={stone.connected ? STONE : STONE_OPEN}
          className={stone.connected ? "road-stone" : "road-stone-open"}
          strokeWidth={STONE_RIM}
          data-milestone={stone.connected ? "connected" : "dead-end"}
        />
      ))}
      {network.junctions.map((junction) => (
        <g key={`${junction.x},${junction.y}`} data-junction="">
          <circle cx={junction.x} cy={junction.y} r={JUNCTION} className="road-junction" strokeWidth={JUNCTION_RIM} />
          <circle cx={junction.x} cy={junction.y} r={JUNCTION_CORE} className="road-junction-core" />
        </g>
      ))}
    </g>
  );
}
