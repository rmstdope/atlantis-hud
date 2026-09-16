/**
 * Which hexes guards stopped a move into this turn, and what the map and the Region panel say
 * about each (ah-vq8z). Pure, so the grouping and the wording are tested without a DOM.
 */

import type { BlockedMove } from "@atlantis/core-client";
import { regionIdOf } from "../hexMapModel";

/** Everything the map and the Region panel need to know about one blocked hex. */
export type BlockedHex = {
  /** `regionIdOf(coordinate)`. */
  regionId: string;
  /** The map label: `7235`, `7235 +1`, or `guards`. Never wraps. */
  label: string;
  /** The Region panel's sentences, in order: one per named guard (report order of first appearance), then one for all ships. */
  sentences: string[];
};

/** Groups the turn's blocked moves by hex, keyed by region id, in report order. */
export function blockedHexes(moves: readonly BlockedMove[]): Map<string, BlockedHex> {
  type Gathered = {
    guards: Map<string, { name: string; movers: Map<string, string> }>;
    ships: Map<string, string>;
  };
  const byHex = new Map<string, Gathered>();
  for (const move of moves) {
    const regionId = regionIdOf(move.coordinate);
    let gathered = byHex.get(regionId);
    if (!gathered) {
      gathered = { guards: new Map(), ships: new Map() };
      byHex.set(regionId, gathered);
    }
    if (move.guard) {
      let guard = gathered.guards.get(move.guard.id);
      if (!guard) {
        guard = { name: move.guard.name, movers: new Map() };
        gathered.guards.set(move.guard.id, guard);
      }
      if (!guard.movers.has(move.moverId)) {
        guard.movers.set(move.moverId, `${move.moverName} (${move.moverId})`);
      }
    } else if (!gathered.ships.has(move.moverId)) {
      gathered.ships.set(move.moverId, `${move.moverName} [${move.moverId}]`);
    }
  }

  const result = new Map<string, BlockedHex>();
  for (const [regionId, { guards, ships }] of byHex) {
    const sentences = [...guards].map(
      ([id, guard]) => `${guard.name} (${id}) kept out ${joinNames([...guard.movers.values()])}.`
    );
    if (ships.size > 0) sentences.push(`Guards stopped ${joinNames([...ships.values()])}.`);
    const guardIds = [...guards.keys()];
    const label =
      guardIds.length === 0
        ? "guards"
        : guardIds.length === 1
          ? guardIds[0]!
          : `${guardIds[0]} +${guardIds.length - 1}`;
    result.set(regionId, { regionId, label, sentences });
  }
  return result;
}

/** `A`, `A and B`, `A, B and C`: the list form every sentence uses. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
