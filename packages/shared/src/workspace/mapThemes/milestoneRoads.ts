/**
 * The shapes of the road network, worked out from the hex views: what the milestone road layer
 * draws.
 *
 * A road runs from a hex's centre to one of its edges, and only counts once the hex beyond has the
 * matching road back: "To gain a movement bonus, there must be two connecting roads, one in each
 * adjacent hex" (`rules/economy_roads`). So each edge a road reaches gets a milestone saying whether
 * it connects. A hex with exactly two roads joins them in one curve through its centre rather than
 * two spokes meeting at a point; a hex with three or more is a junction and keeps its spokes. A road
 * still being built is drawn dotted, half by half, so a curve can be half finished.
 */

import { HEX_RADIUS } from "../mapViewport";
import { ROAD_VECTORS, type HexView, type RoadDirection } from "./hexView";

/** Where a road reaches, as a fraction of the radius: exactly the edge midpoint, which both hexes share. */
const REACH = Math.sqrt(3) / 2;
/** Centre to centre, one hex to its neighbour. */
const NEIGHBOUR = Math.sqrt(3) * HEX_RADIUS;

const OPPOSITE: Record<RoadDirection, RoadDirection> = {
  n: "s",
  ne: "sw",
  se: "nw",
  s: "n",
  sw: "ne",
  nw: "se"
};

export type RoadPiece = { d: string; unfinished: boolean };
export type Milestone = { x: number; y: number; connected: boolean };
export type RoadNetwork = { pieces: RoadPiece[]; milestones: Milestone[]; junctions: { x: number; y: number }[] };

type Point = { x: number; y: number };

const fixed = (value: number) => (Math.round(value * 1000) / 1000).toString();
const placeKey = (point: Point) => `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;
const toward = (from: Point, direction: RoadDirection, distance: number): Point => ({
  x: from.x + ROAD_VECTORS[direction].x * distance,
  y: from.y + ROAD_VECTORS[direction].y * distance
});

export function roadNetwork(views: HexView[]): RoadNetwork {
  const byPlace = new Map(views.map((view) => [placeKey(view.at), view]));
  const pieces: RoadPiece[] = [];
  const milestones = new Map<string, Milestone>();
  const junctions: { x: number; y: number }[] = [];

  for (const view of views) {
    const roads = view.roads;
    if (roads.length === 0) {
      continue;
    }
    const unfinished = (direction: RoadDirection) => view.unfinishedRoads.includes(direction);
    const edges = roads.map((direction) => toward(view.at, direction, HEX_RADIUS * REACH));

    if (roads.length === 2) {
      // The quadratic edge -> centre -> edge, cut at its middle so each half is one road's.
      const [a, b] = edges;
      const c = view.at;
      const middle = { x: (a.x + 2 * c.x + b.x) / 4, y: (a.y + 2 * c.y + b.y) / 4 };
      pieces.push({
        d: `M${fixed(a.x)},${fixed(a.y)} Q${fixed((a.x + c.x) / 2)},${fixed((a.y + c.y) / 2)} ${fixed(middle.x)},${fixed(middle.y)}`,
        unfinished: unfinished(roads[0])
      });
      pieces.push({
        d: `M${fixed(middle.x)},${fixed(middle.y)} Q${fixed((c.x + b.x) / 2)},${fixed((c.y + b.y) / 2)} ${fixed(b.x)},${fixed(b.y)}`,
        unfinished: unfinished(roads[1])
      });
    } else {
      roads.forEach((direction, index) => {
        pieces.push({
          d: `M${fixed(view.at.x)},${fixed(view.at.y)} L${fixed(edges[index].x)},${fixed(edges[index].y)}`,
          unfinished: unfinished(direction)
        });
      });
      if (roads.length >= 3) {
        junctions.push({ x: view.at.x, y: view.at.y });
      }
    }

    roads.forEach((direction, index) => {
      const neighbour = byPlace.get(placeKey(toward(view.at, direction, NEIGHBOUR)));
      const connected = neighbour?.roads.includes(OPPOSITE[direction]) ?? false;
      const key = placeKey(edges[index]);
      const seen = milestones.get(key);
      milestones.set(key, { ...edges[index], connected: connected || (seen?.connected ?? false) });
    });
  }

  return { pieces, milestones: [...milestones.values()], junctions };
}
