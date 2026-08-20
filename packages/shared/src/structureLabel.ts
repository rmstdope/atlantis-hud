import type { StructureInfo } from "@atlantis/core-client";

/**
 * How a structure is named wherever it is written out in full: `Odds and Ends [12] · Fort`.
 *
 * One helper because the units table and the region pane must agree — the same structure read two
 * different ways in two panes is the defect this was extracted for (ah-kdgc).
 */
export function structureLabel(structure: StructureInfo): string {
  const { prefix, kind } = structureLabelParts(structure);
  return `${prefix}${kind}`;
}

/**
 * The same label in two pieces, split where the region pane needs to link the kind alone.
 *
 * `kind` is the catalogue entry; `prefix` is this region's own name for the structure and its
 * number, which name no entry at all. The two are derived here rather than in the pane so the
 * linked form and the written-out form cannot drift apart (ah-5jkt.2).
 */
export function structureLabelParts(structure: StructureInfo): { prefix: string; kind: string } {
  return { prefix: `${structure.name} [${structure.structureId}] · `, kind: structure.kind };
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

/**
 * How a structure reads in the command palette: `Arcane Mine [12] · cavern (3,41)`, and
 * `Building [4] · Mine · plain (9,22)` when the report gave it no name of its own.
 *
 * The kind is spelled out only where the name does not carry it, which is the navigator's choice
 * for ah-wkwk: short where it can be, informative where it must be. Whether a structure is named
 * is decided by the same rule as `structure_label` in `crates/core/src/orders/semantics.rs` -
 * `Building` and `Ship` are the engine's own words for an unnamed structure, matched
 * case-insensitively. Mirrored rather than reinvented, so the two cannot drift apart.
 */
export function structurePaletteLabel(structure: StructureInfo, hexLabel: string): string {
  const unnamed = ["building", "ship"].includes(structure.name.toLowerCase());
  const kind = unnamed ? `${structure.kind} · ` : "";
  return `${structure.name} [${structure.structureId}] · ${kind}${hexLabel}`;
}
