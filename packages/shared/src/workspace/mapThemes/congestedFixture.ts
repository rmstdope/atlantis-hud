/**
 * The congested neighbourhood every theme is judged against.
 *
 * The real test of a hex design is not the sparse hex but the full one, so this is the same
 * deliberately overloaded seven-hex patch the design proposals were drawn over
 * (`docs/ui/hex-design-proposals.html`): a city with a battle, a guard, three unit groups, works,
 * a ship and two roads in a single hex, beside a cave with a shaft and monsters in it.
 *
 * Shared by all six themes rather than re-invented per theme, so that "does this layout collide?"
 * is asked of every theme with the same question.
 */

import type { Coordinate, ReportRegion, ReportUnit, StructureInfo } from "@atlantis/core-client";
import type { HexKnowledge, HexNode } from "../../hexMapModel";

const LEVEL = 1;

function at(x: number, y: number): Coordinate {
  return { x, y, z: LEVEL };
}

function structure(kind: string): StructureInfo {
  return { structureId: `${kind}-1`, name: kind, kind, description: null, needs: null };
}

function unit(overrides: Partial<ReportUnit> = {}): ReportUnit {
  return {
    unitId: "900",
    name: "Walker",
    regionId: "",
    factionId: "17",
    factionName: "Own",
    own: true,
    onGuard: false,
    flags: [],
    items: [],
    skills: [],
    men: 1,
    menEstimated: false,
    menByRace: [],
    weight: null,
    capacity: null,
    structureId: null,
    ...overrides
  };
}

/** Units laid out as counts rather than one call per unit, which the hexes below read better as. */
function units(spec: { own?: number; foreign?: number; monsters?: number; guard?: boolean }) {
  const made: ReportUnit[] = [];
  for (let index = 0; index < (spec.own ?? 0); index += 1) {
    made.push(unit({ unitId: `own-${index}`, onGuard: spec.guard === true && index === 0 }));
  }
  for (let index = 0; index < (spec.foreign ?? 0); index += 1) {
    made.push(unit({ unitId: `foreign-${index}`, own: false, factionId: "95", factionName: "Foo" }));
  }
  for (let index = 0; index < (spec.monsters ?? 0); index += 1) {
    made.push(
      unit({ unitId: `monster-${index}`, own: false, factionId: "2", factionName: "Creatures" })
    );
  }
  return made;
}

function hex(spec: {
  coordinate: Coordinate;
  terrain: string;
  knowledge: HexKnowledge;
  ageInTurns?: number;
  settlement?: { name: string; size: string };
  structures?: string[];
  units?: ReportUnit[];
  visited?: boolean;
}): HexNode {
  const regionId = `${LEVEL}:${spec.coordinate.x},${spec.coordinate.y}`;
  const held = spec.units ?? [];
  const region: ReportRegion | null =
    spec.visited === false
      ? null
      : {
          regionId,
          coordinate: spec.coordinate,
          terrain: spec.terrain,
          province: "Inhead",
          settlement: spec.settlement ?? null,
          population: null,
          race: null,
          taxBase: null,
          wages: null,
          maxWages: null,
          entertainment: null,
          products: [],
          wanted: [],
          forSale: [],
          exits: [],
          structures: (spec.structures ?? []).map(structure),
          units: held.map((held) => ({ ...held, regionId }))
        };

  return {
    regionId,
    coordinate: spec.coordinate,
    terrain: spec.terrain,
    province: "Inhead",
    label: `${spec.terrain} (${spec.coordinate.x},${spec.coordinate.y}) in Inhead`,
    knowledge: spec.knowledge,
    lastSeenTurn: 71 - (spec.ageInTurns ?? 0),
    ageInTurns: spec.knowledge === "named" ? null : (spec.ageInTurns ?? 0),
    settlementName: spec.settlement?.name ?? null,
    region,
    ownUnitCount: held.filter((unit) => unit.own).length,
    foreignUnitCount: held.filter((unit) => !unit.own).length
  };
}

/** The centre hex: everything at once, which is what the layouts have to survive. */
export const CONGESTED_CENTRE = hex({
  coordinate: at(7, 53),
  terrain: "plain",
  knowledge: "current",
  settlement: { name: "Marn", size: "city" },
  structures: ["road n", "road se", "Mine", "Tower", "Granary", "Temple", "Galley"],
  units: units({ own: 12, foreign: 3, monsters: 5, guard: true })
});

/**
 * The seven-hex neighbourhood.
 *
 * Between them the hexes cover every piece of vocabulary the view model can currently produce:
 * all three settlement tiers, own, foreign and monster units, an own guard and a foreign one,
 * roads, works, a ship, a shaft, a lair, stale knowledge and a hex known only by name.
 */
export const CONGESTED_HEXES: HexNode[] = [
  CONGESTED_CENTRE,
  hex({
    coordinate: at(7, 51),
    terrain: "mountain",
    knowledge: "current",
    structures: ["road s", "Shaft", "Cave"],
    units: units({ foreign: 6, monsters: 2, guard: false })
  }),
  hex({
    coordinate: at(8, 52),
    terrain: "forest",
    knowledge: "current",
    settlement: { name: "Eda", size: "town" },
    structures: ["road sw", "Lumberyard", "Quarry", "Tower", "Farm"],
    units: units({ own: 4, foreign: 2 })
  }),
  hex({
    coordinate: at(8, 54),
    terrain: "ocean",
    knowledge: "current",
    structures: ["Longship"],
    units: units({ own: 2, foreign: 3 })
  }),
  hex({
    coordinate: at(7, 55),
    terrain: "swamp",
    knowledge: "current",
    structures: ["Ruin"],
    units: units({ foreign: 2 })
  }),
  hex({
    coordinate: at(6, 54),
    terrain: "desert",
    knowledge: "current",
    settlement: { name: "Kel", size: "village" },
    structures: ["Mine", "Shaft"],
    units: units({ own: 4, guard: true })
  }),
  // Seen eight turns ago and not since: the one hex whose knowledge has aged. A stale hex carries
  // no units - a unit standing here eight turns ago may have moved, disbanded or died (ah-o86).
  hex({
    coordinate: at(6, 52),
    terrain: "tundra",
    knowledge: "stale",
    ageInTurns: 8,
    settlement: { name: "Hut", size: "village" },
    structures: ["Hut"]
  })
];

/** A hex known only from a neighbour's exits: terrain, province and a name, and nothing else. */
export const NAMED_ONLY: HexNode = hex({
  coordinate: at(9, 53),
  terrain: "jungle",
  knowledge: "named",
  settlement: { name: "Far", size: "town" },
  visited: false
});
