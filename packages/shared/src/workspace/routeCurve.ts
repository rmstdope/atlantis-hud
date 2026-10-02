/**
 * A movement line drawn as a gentle curve through the hex centres rather than a run of corners.
 *
 * The curve is a Catmull-Rom spline through every centre, sampled into short straight pieces, so
 * the result is still an SVG `points` list: the line, its glow and the comet riding it all read
 * the same points, and the comet stays on the curve without asking the browser where it is. The
 * two halves of a journey - this month and later - are curved as one route and then cut apart at
 * the month's end, so they meet without a kink.
 */

import { parsePoints, type Point } from "./routeCometPath";

/** How far a curve may swing past a corner: 0 is the plain polyline, 0.5 a full Catmull-Rom. */
const TENSION = 0.35;
/** Straight pieces per hex-to-hex step; enough that no facet shows at the closest zoom. */
const SAMPLES = 12;

/** Three decimals, as `routeSegments` writes them, so a point the line ends on is the same text. */
const fixed = (value: number) => {
  const text = value.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
};
const format = (points: Point[]) => points.map((point) => `${fixed(point.x)},${fixed(point.y)}`).join(" ");

/** The curve through `points`, sampled; the given points are all on it, in order. */
export function curveThrough(points: Point[]): Point[] {
  if (points.length < 3) {
    return points;
  }
  const out: Point[] = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1 = { x: p1.x + ((p2.x - p0.x) * TENSION) / 3, y: p1.y + ((p2.y - p0.y) * TENSION) / 3 };
    const c2 = { x: p2.x - ((p3.x - p1.x) * TENSION) / 3, y: p2.y - ((p3.y - p1.y) * TENSION) / 3 };
    for (let sample = 1; sample <= SAMPLES; sample += 1) {
      const t = sample / SAMPLES;
      const u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y
      });
    }
  }
  return out;
}

/**
 * Both halves of a line, curved as one. `dotted` starts at the last point of `solid`, as
 * `routeSegments` draws them; the result keeps that shape.
 */
export function curvedHalves(solid: string, dotted: string): { solid: string; dotted: string } {
  const near = parsePoints(solid);
  const far = parsePoints(dotted);
  const joined = near.length > 0 && far.length > 0 ? [...near, ...far.slice(1)] : [...near, ...far];
  const curve = curveThrough(joined);
  if (joined.length < 3) {
    return { solid, dotted };
  }
  // Every original point lands on a sample boundary, so the month's end is found by count.
  const cut = near.length > 0 ? (near.length - 1) * SAMPLES : 0;
  return {
    solid: near.length > 1 ? format(curve.slice(0, cut + 1)) : "",
    dotted: far.length > 1 ? format(curve.slice(cut)) : ""
  };
}
