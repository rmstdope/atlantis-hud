/**
 * Builders for the shared package's own view types, in the style of `@atlantis/core-client`'s
 * builders: a complete value with every field set, and a shallow `Partial<T>` of overrides.
 *
 * `aHexNode` is built through `hexNodeOf` from `aKnownMapHex`, so a field added to the core's
 * known hex and carried onto the screen's hex gets its default in one place, and no test that
 * builds a hex has to spell it out (ah-152m).
 */
import { aKnownMapHex } from "@atlantis/core-client";
import { hexNodeOf, type HexNode } from "../hexMapModel";

/** The turn the default known hex was resolved at; the same turn `aKnownMap` defaults to. */
const DEFAULT_TURN = 71;

/**
 * The screen's view of the default known hex: the mountain at (7,53) in Inhead, seen this turn,
 * nobody in it. `regionId` and `label` follow `coordinate` unless they are given too.
 */
export function aHexNode(overrides: Partial<HexNode> = {}): HexNode {
  const known = overrides.coordinate ? aKnownMapHex({ coordinate: overrides.coordinate }) : aKnownMapHex();
  return { ...hexNodeOf(known, DEFAULT_TURN), ...overrides };
}
