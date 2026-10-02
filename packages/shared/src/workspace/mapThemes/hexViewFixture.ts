/**
 * The one full `HexView` literal the tests build from (ah-2z2j).
 *
 * A bare forest hex: no fog, current, and nothing a theme would mark. A test names only the fields
 * it is about and takes the rest from here, so a new `HexView` field gets its test default in this
 * file and nowhere else.
 */

import type { HexView } from "./hexView";

export function aHexView(overrides: Partial<HexView> = {}): HexView {
  return {
    key: "12,7,1",
    at: { x: 100, y: 200 },
    terrain: "forest",
    terrainKind: "forest",
    texture: null,
    fogOpacity: 0,
    hatched: false,
    unsurveyed: false,
    knowledge: "current",
    ageInTurns: 0,
    roads: [],
    unfinishedRoads: [],
    settlement: null,
    units: { own: 0, foreign: 0, monster: 0 },
    guard: null,
    ships: 0,
    buildings: 0,
    shafts: 0,
    lairs: 0,
    battle: null,
    blocked: null,
    gate: false,
    ...overrides
  };
}
