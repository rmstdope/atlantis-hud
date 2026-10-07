/**
 * Builders for the shared package's own view types, in the style of `@atlantis/core-client`'s
 * builders: a complete value with every field set, and a shallow `Partial<T>` of overrides.
 *
 * `aHexNode` is built through `hexNodeOf` from `aKnownMapHex`, so a field added to the core's
 * known hex and carried onto the screen's hex gets its default in one place, and no test that
 * builds a hex has to spell it out (ah-152m).
 */
import { aKnownMap, aKnownMapHex, type KnownMapHex } from "@atlantis/core-client";
import { hexNodeOf, type HexNode } from "../hexMapModel";

/** The turn the default known hex is resolved at: `aKnownMap`'s, so the number has one source. */
const DEFAULT_TURN = aKnownMap().currentTurn;

/**
 * The screen's view of the default known hex: the mountain at (7,53) in Inhead, seen this turn,
 * nobody in it. `regionId` follows `coordinate`, and `label` follows `coordinate`, `terrain` and
 * `province`, unless they are given too. The other derived fields (`ageInTurns`, the unit counts)
 * are the default hex's, whatever `knowledge` or `region` are overridden to.
 */
export function aHexNode(overrides: Partial<HexNode> = {}): HexNode {
  const known: Partial<KnownMapHex> = {};
  if (overrides.coordinate) known.coordinate = overrides.coordinate;
  if (overrides.terrain !== undefined) known.terrain = overrides.terrain;
  if (overrides.province !== undefined) known.province = overrides.province;
  return { ...hexNodeOf(aKnownMapHex(known), DEFAULT_TURN), ...overrides };
}
