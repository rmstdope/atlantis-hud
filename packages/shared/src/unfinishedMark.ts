import type { CreatedItem, ItemAmount, RegionPreview } from "@atlantis/core-client";
import { withoutSilver } from "./silverTag";
import type { StructuresByRegion } from "./structureLabel";

/**
 * Which structures and items the Units in hex pane marks as unfinished (`ah-2ql5`).
 *
 * Kept pure, apart from the components that draw the mark, because `packages/shared` renders its
 * component tests without effects (`.cerebro/traps.md`): every rule the mark follows is here.
 */

/**
 * How a structure a row stands in reads at the month's end.
 *
 * `unfinished`: the report writes it `, needs N` and nothing this month is known to finish it.
 * `finishing`: unfinished in the report, and this month's `BUILD`s lay its last work.
 * `null`: finished, no structure at all, or one the report never described - nothing to mark.
 */
export type StructureFinish = "unfinished" | "finishing" | null;

/** Region id to the ids of the structures this month's `BUILD`s finish there. */
export type FinishingStructures = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Every structure this month's `BUILD`s finish, read off the core's `BuildSpend.finishes`.
 *
 * Only from rows where the report lists the unit: an arriving copy carries the same spends, but a
 * building is finished in the hex its builder stands in, which is the row's own region.
 */
export function finishingStructuresOf(
  preview: { regions: readonly RegionPreview[] } | null | undefined
): FinishingStructures {
  const finishing = new Map<string, Set<string>>();
  for (const region of preview?.regions ?? []) {
    for (const row of region.units) {
      if (row.status === "arriving") {
        continue;
      }
      for (const spend of row.built ?? []) {
        if (spend.finishes != null) {
          const ids = finishing.get(region.regionId) ?? new Set<string>();
          ids.add(spend.finishes);
          finishing.set(region.regionId, ids);
        }
      }
    }
  }
  return finishing;
}

/**
 * Whether the structure a row names is unfinished at the month's end.
 *
 * `regionId` is the region that numbered the structure (`structureRegionOf`), since a structure
 * number is scoped to its region. A structure the region never described has no `needs` to read,
 * so it is not marked: nothing is known about it.
 */
export function structureFinishState(
  regionId: string,
  structureId: string | null,
  byRegion: StructuresByRegion,
  finishing: FinishingStructures
): StructureFinish {
  if (structureId === null) {
    return null;
  }
  const needs = byRegion.get(regionId)?.get(structureId)?.needs;
  if (needs == null) {
    return null;
  }
  return finishing.get(regionId)?.has(structureId) ? "finishing" : "unfinished";
}

const UNFINISHED = "unfinished ";

/**
 * An unfinished ship, by the report's own words: `unfinished Galleon`.
 *
 * `rules/economy_ships`: "unfinished ships appear only in their builder's inventory until they are
 * complete", and the report names one with this prefix. The prefix, with a name after it, decides,
 * as the core's `is_unfinished_ship` does without a ruleset.
 */
export function isUnfinishedShipName(name: string | undefined): boolean {
  return (
    name !== undefined &&
    name.length > UNFINISHED.length &&
    name.slice(0, UNFINISHED.length).toLowerCase() === UNFINISHED
  );
}

/**
 * One entry of the Items cell, whether the unfinished mark goes before it, and - only where it is
 * so - whether it is a material a refused cast leaves the unit short of, drawn red (`ah-44at`).
 */
export type ItemCellPart = {
  text: string;
  unfinished: boolean;
  /** The item's code, which `text` always ends with - what the units filter marks (`ah-ykac`). */
  tag: string;
  /** The item's name, which the units filter also matches though the cell never prints it. */
  name: string;
};

/**
 * The Items cell's entries, silver left out, each as `formatItems` writes it.
 *
 * A `CAST` whose creation is uncertain draws its range, `2-5 SWOR`, exactly as before. A refused
 * cast moves no material, so it adds no entry here: its ⚠ is the cell's own (`ah-rjz2`).
 */
export function itemCellParts(
  items: readonly ItemAmount[],
  created: readonly CreatedItem[] = [],
  /**
   * Keep silver, where the report listed it: for a unit filled in from a merged faction's own
   * report, whose Silver column is empty and whose silver is therefore said here (`ah-oqxn`).
   */
  { withSilver = false }: { withSilver?: boolean } = {}
): ItemCellPart[] {
  const shortfall = new Map<string, number>();
  for (const item of created) {
    shortfall.set(item.tag, (shortfall.get(item.tag) ?? 0) + (item.most - item.fewest));
  }
  const listed = withSilver ? items : withoutSilver(items);
  return listed.map((item) => {
    const gap = shortfall.get(item.tag) ?? 0;
    return {
      text: gap > 0 ? `${item.amount - gap}-${item.amount} ${item.tag}` : `${item.amount} ${item.tag}`,
      unfinished: isUnfinishedShipName(item.name),
      tag: item.tag,
      name: item.name
    };
  });
}
