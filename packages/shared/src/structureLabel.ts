import type { StructureInfo } from "@atlantis/core-client";

/**
 * How a structure is named wherever it is written out in full: `Odds and Ends [12] · Fort`.
 *
 * One helper because the units table and the region pane must agree — the same structure read two
 * different ways in two panes is the defect this was extracted for (ah-kdgc).
 */
export function structureLabel(structure: StructureInfo): string {
  return `${structure.name} [${structure.structureId}] · ${structure.kind}`;
}

/**
 * The label for the structure a unit names, or the bare `[id]` when the region never described it.
 *
 * `null` when the unit is in no structure at all. A unit can name a structure the report did not
 * carry — a stale hex, or one seen from outside — and that is not the same as being outdoors, so
 * the number is kept rather than the cell left empty.
 *
 * `structures` may be a Map keyed by structure id, which is what the units table passes: a hex can
 * hold three hundred units across two dozen structures and the table re-renders on every scroll
 * frame, so the lookup must not be a scan per row.
 */
export function unitStructureLabel(
  structureId: string | null,
  structures: readonly StructureInfo[] | ReadonlyMap<string, StructureInfo>
): string | null {
  if (structureId === null) {
    return null;
  }
  const match =
    structures instanceof Map
      ? structures.get(structureId)
      : (structures as readonly StructureInfo[]).find(
          (structure) => structure.structureId === structureId
        );
  return match ? structureLabel(match) : `[${structureId}]`;
}
