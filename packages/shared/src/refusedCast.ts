import { midSentence } from "./formedUnitName";
import type { RefusedCast } from "@atlantis/core-client";
import type { PreviewedUnit } from "./unitPreview";

/**
 * What a `CAST` the game refuses leaves on the ITEMS column (`ah-44at`, revised by `ah-rjz2`): it
 * takes nothing, so no material moves; its product is struck through with the reason, and a cast
 * short of a material puts an amber ⚠ on the cell.
 *
 * Pure, and kept apart from the cell and the popup, so both read one answer and so it can be
 * tested at all - `packages/shared` has no jsdom (`.cerebro/traps.md`).
 */

/**
 * How the hover names an item: its own line's name for `tag`, else `fallback`. Passed in, so the
 * product's reason names it exactly as its struck line does.
 */
export type ItemNamer = (tag: string, fallback: string) => string;

/**
 * A count and its noun agreeing in number - `1 floater hide`, `75 floater hides` - by the rule the
 * core's `counted_item` keeps: one takes the singular, any other count the report's plural.
 */
export function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** `a`, `a and b`, `a, b and c` - for a clause naming several things. */
export function andList(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  // The item before "and" closes a formed unit's phrase with its comma (`ah-uxaw`); the items
  // before it already have the list's own.
  const leading = [...parts.slice(0, -2), midSentence(parts[parts.length - 2])];
  return `${leading.join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Whether a refused cast leaves this unit's Items cell its ⚠ (`ah-rjz2`, Q3 A): a cast refused for
 * a material, whatever its silver. One refused for its silver alone touches no item, so its ⚠ is
 * the Silver cell's.
 */
export function itemsRefused(unit: PreviewedUnit): boolean {
  return (unit.refusedCasts ?? []).some((cast) => cast.short.length > 0);
}

/** The Items hover's ⚠ sentence, worded as the Silver cell's is (`ah-rjz2`, Q4 A). */
export const ITEMS_WARNING =
  "⚠ in the cell: a check warns about this unit's items. Select the unit to read it in the Problems panel.";

/**
 * Why a refused cast's product is struck through: `Cloudship: not created — the cast is 75 floater
 * hides short.` A cast short of silver and goods both is refused for its silver
 * (`CastOutcome::settle`), so the silver is what it names then.
 */
export function refusedProductReason(cast: RefusedCast, name: ItemNamer): string {
  const product = cast.product ? name(cast.product.tag, cast.product.name) : "";
  const what =
    cast.silverShort > 0
      ? `${cast.silverShort} silver`
      : andList(
          cast.short.map((material) => counted(material.amount, material.name, material.plural))
        );
  return `${product}: not created — the cast is ${what} short.`;
}
