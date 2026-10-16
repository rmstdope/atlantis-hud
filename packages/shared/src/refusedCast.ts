import type { RefusedCast } from "@atlantis/core-client";
import type { PreviewedUnit } from "./unitPreview";

/**
 * What a `CAST` the game refuses leaves on the ITEMS column (`ah-44at`): the material it is short
 * of ends at a red minus figure, as silver does for a refused study, and one red sentence says so.
 *
 * Pure, and kept apart from the cell and the popup, so both read one answer and so it can be
 * tested at all - `packages/shared` has no jsdom (`.cerebro/traps.md`).
 */

/** One material a refused cast leaves this unit short of at the month's end. */
export type ShortItem = {
  tag: string;
  /** The catalogue's singular, as the core names it. */
  name: string;
  /** The report's own plural, or the singular where the report never shows one (`ah-rsdz`). */
  plural: string;
  /** Below zero, always: what the unit ends the month at. */
  figure: number;
};

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

/** How a short material's own line names it, agreeing with the figure it ends at. */
export function shortName(item: ShortItem): string {
  return -item.figure === 1 ? item.name : item.plural;
}

/** `a`, `a and b`, `a, b and c` - for a clause naming several things. */
export function andList(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Every material this unit's refused casts are short of and that it still ends the month below
 * zero on, in the order the month first moves each (the order the hover's lines are in).
 *
 * The figure is what the unit holds at the month's end less every refused cast's shortfall of the
 * tag: the core charges a refused cast the material it is short of (`ah-ofpb.5`) and the preview
 * clamps that stock at none, so the shortfall is what the clamp hid. A later arrival - a BUY runs
 * after CAST (`rules/sequenceofevents`) - counts against it, as the Silver column's own figure
 * counts later income.
 */
export function shortItems(unit: PreviewedUnit): ShortItem[] {
  const short = new Map<string, { name: string; plural: string; amount: number }>();
  for (const cast of unit.refusedCasts ?? []) {
    for (const material of cast.short) {
      const before = short.get(material.tag);
      short.set(material.tag, {
        name: before?.name ?? material.name,
        plural: before?.plural ?? material.plural,
        amount: (before?.amount ?? 0) + material.amount
      });
    }
  }
  const changes = unit.itemChanges ?? [];
  const place = (tag: string): number => {
    const index = changes.findIndex((change) => change.tag === tag);
    return index < 0 ? changes.length : index;
  };
  return [...short]
    .map(([tag, { name, plural, amount }]) => ({
      tag,
      name,
      plural,
      figure: (unit.items.find((item) => item.tag === tag)?.amount ?? 0) - amount
    }))
    .filter((item) => item.figure < 0)
    .sort((a, b) => place(a.tag) - place(b.tag));
}

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

/** The one red sentence for every short material, or `null` when there is none. */
export function shortSentence(items: readonly ShortItem[]): string | null {
  if (items.length === 0) {
    return null;
  }
  const what = andList(items.map((item) => `${-item.figure} ${shortName(item)}`));
  return `A red figure in the cell: this unit ends the month ${what} short.`;
}
