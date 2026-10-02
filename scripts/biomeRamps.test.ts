import { describe, expect, it } from "vitest";
import { BIOMES, clashPairs, difference, type Rgb } from "./colourDistance";
import { STANDARD_RAMPS } from "./biomeRamps";

/**
 * The Standard texture set's colour ramps (ah-d9jb.1).
 *
 * At far zoom a hex is 12-20 px across and its texture averages out to one colour, so that average
 * is what has to differ between biomes a person must tell apart.
 */

/** The ramp's colour averaged over the whole field, sampled evenly from dark to light. */
function averageOf(stops: readonly (readonly [number, Rgb])[]): Rgb {
  const samples = 200;
  const sum = [0, 0, 0];
  for (let index = 0; index <= samples; index += 1) {
    const value = index / samples;
    const upper = stops.findIndex(([position]) => position >= value);
    const [p1, c1] = stops[Math.max(upper, 1)];
    const [p0, c0] = stops[Math.max(upper, 1) - 1];
    const t = Math.min(1, Math.max(0, (value - p0) / (p1 - p0)));
    for (let channel = 0; channel < 3; channel += 1) {
      sum[channel] += c0[channel] * (1 - t) + c1[channel] * t;
    }
  }
  return sum.map((total) => total / (samples + 1)) as unknown as Rgb;
}

/**
 * The same floor as the flat colours. Every agreed pair clears it (the closest, cavern / chasm, at
 * 5.7); the ramps this set replaced fell under it for hill / wasteland (2.7), cavern / tunnels
 * (3.1), underforest / deepforest (3.3) and cavern / chasm (4.2).
 */
const FLOOR = 5;

describe("the Standard texture ramps", () => {
  it("has one ramp for each of the 17 biomes", () => {
    expect(Object.keys(STANDARD_RAMPS).sort()).toEqual([...BIOMES].sort());
  });

  it("draws tunnels in the darker, bluer ramp agreed to set it apart from cavern", () => {
    expect(STANDARD_RAMPS.tunnels).toEqual([
      [0, [0x0e, 0x14, 0x24]],
      [0.45, [0x18, 0x22, 0x3a]],
      [0.75, [0x22, 0x30, 0x50]],
      [1, [0x34, 0x44, 0x68]]
    ]);
  });

  it.each(clashPairs())("tells %s from %s at far zoom", (first, second) => {
    expect(
      difference(averageOf(STANDARD_RAMPS[first]), averageOf(STANDARD_RAMPS[second]))
    ).toBeGreaterThanOrEqual(FLOOR);
  });
});
