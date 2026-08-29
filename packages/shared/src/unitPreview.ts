import type {
  BuildSpend,
  CreatedItem,
  FieldChange,
  ItemAmount,
  OrdersPreviewResponse,
  ProducedItem,
  RegionPreview,
  ReportUnit,
  TakenUnshown,
  TransportReceived,
  TransportSent,
  UnitPreview,
  UnitPreviewStatus,
  UnitSilver
} from "@atlantis/core-client";
import {
  buyAllSentences,
  castCapSentence,
  productionCapSentence,
  productionMenSentence
} from "./unitTooltip";

/**
 * How the orders preview folds into the units table.
 *
 * Pure for the same reason unitTable.ts is: none of it needs a DOM, and the repository has no
 * jsdom, so keeping it out of the component is what makes it testable at all.
 */

/**
 * A table row: a unit, possibly as the orders leave it rather than as the report found it.
 *
 * An extension of `ReportUnit` rather than a wrapper, so everything that already handles units -
 * sorting, filtering, the row cap, the tooltip - keeps working without knowing the preview
 * exists. The extra fields are absent on a row the orders left alone.
 */
export type PreviewedUnit = ReportUnit & {
  previewStatus?: UnitPreviewStatus;
  previewChanges?: FieldChange[];
  /** Where an arriving unit set out from. */
  arrivingFrom?: string | null;
  /** Where a departing unit ends the month, when the trace could say. */
  departingTo?: string | null;
  /** The fleet carrying this unit away, as `<name> [<id>]`, when the ship it stands in departs. */
  aboard?: string | null;
  /**
   * This unit's orders whose effect on its items could not be counted, verbatim, in document
   * order (`ah-agbm`).
   */
  uncounted?: string[];
  /** Silver or goods taken from a unit the report does not show in this hex (`ah-agbm`). */
  takenUnshown?: TakenUnshown[];
  /** What this unit's PRODUCE orders make this month (`ah-ofpb.1`). */
  produced?: ProducedItem[];
  /** What this unit's BUILD orders spend this month (`ah-ofpb.2`). */
  built?: BuildSpend[];
  /** What this unit's CAST orders create this month (`ah-ofpb.5`). */
  created?: CreatedItem[];
  /** What this unit's TRANSPORT/DISTRIBUTE orders send this month, in document order (`ah-bxgs`). */
  transportSent?: TransportSent[];
  /** What arrives at this unit by another unit's TRANSPORT/DISTRIBUTE this month (`ah-bxgs`). */
  transportReceived?: TransportReceived[];
};

/**
 * The hex's units with the orders preview folded in.
 *
 * A previewed unit replaces its report row in place, so the table keeps its arrangement; units
 * the report has no row for - arriving from another hex, or formed this month - are appended.
 * Untouched units come through as the very same objects, so memoization over them survives.
 */
export function mergePreview(
  units: ReportUnit[],
  preview: RegionPreview | null | undefined
): PreviewedUnit[] {
  return foldIn(units, preview?.units ?? []);
}

/**
 * A list spanning hexes - every own unit in the report - with the whole report's preview folded
 * in, one row per unit (`ah-tguk`).
 *
 * **Every `arriving` row is dropped, and that is what leaves exactly one row per unit.** The core
 * emits a moving unit twice: an `arriving` row in the destination region and a `departing` row in
 * the origin, pushed as a pair inside one block (`crates/core/src/orders/effects.rs`), so a list
 * that spans every hex would otherwise show the same unit twice - and a roster of your own units
 * is not a place for that. Dropping the arrival keeps the unit on the hex the report gave it, with
 * the `-> destination` marker its departing row already carries; a departure the trace could not
 * name a destination for has no arrival row at all, and is kept.
 */
export function mergePreviewAcross(
  units: ReportUnit[],
  preview: OrdersPreviewResponse | null | undefined
): PreviewedUnit[] {
  return foldIn(
    units,
    (preview?.regions ?? [])
      .flatMap((region) => region.units)
      .filter((one) => one.status !== "arriving")
  );
}

/**
 * The fold itself, over previewed units already chosen by the caller.
 *
 * Two identity guarantees, both load-bearing rather than tidy: **the very same array back when
 * there is nothing to fold**, and **untouched units as the very same objects**. `visible` in
 * `UnitTableDock` is memoised over the row list and the hover that opens a unit's tooltip is
 * cancelled whenever that array's identity changes; the preview is refreshed on a 300ms debounce
 * as orders are typed, so a fresh array every call would cancel the hover 300ms after it began and
 * the tooltip would never appear (`ah-1wcw.1`, fixed in `ah-1wcw.6`).
 */
function foldIn(units: ReportUnit[], previewed: readonly UnitPreview[]): PreviewedUnit[] {
  if (previewed.length === 0) {
    return units;
  }

  const changed = new Map(previewed.map((unit) => [unit.unit.unitId, unit]));
  const rows: PreviewedUnit[] = units.map((unit) => {
    const found = changed.get(unit.unitId);
    if (!found) {
      return unit;
    }
    changed.delete(unit.unitId);
    return rowFor(found);
  });

  // Whatever is left has no report row here: arrivals and formed units, in preview order.
  for (const found of changed.values()) {
    rows.push(rowFor(found));
  }

  return rows;
}

/** One previewed unit as a table row: the predicted unit, with the preview's extras beside it. */
function rowFor(previewed: UnitPreview): PreviewedUnit {
  return {
    ...previewed.unit,
    previewStatus: previewed.status,
    previewChanges: previewed.changes,
    arrivingFrom: previewed.arrivingFrom,
    departingTo: previewed.departingTo,
    aboard: previewed.aboard,
    uncounted: previewed.uncounted,
    takenUnshown: previewed.takenUnshown,
    produced: previewed.produced,
    built: previewed.built,
    created: previewed.created,
    transportSent: previewed.transportSent,
    transportReceived: previewed.transportReceived
  };
}

/** The recorded change for one field of a row, when the orders changed it. */
export function changeFor(
  unit: PreviewedUnit | undefined,
  field: string
): FieldChange | undefined {
  return unit?.previewChanges?.find((change) => change.field === field);
}

/**
 * The ITEMS cell's text: the same formatting the report uses, in one place so the cell and its
 * hover cannot drift apart (`ah-agbm`).
 *
 * `created` is what a CAST brings that the game leaves partly to chance: the amounts in `items`
 * are already the most the unit may end with, so each entry's low end is that figure less the
 * part that rests on a chance (`ah-ofpb.5`).
 */
export function formatItems(
  items: readonly ItemAmount[],
  created: readonly CreatedItem[] = []
): string {
  const shortfall = new Map<string, number>();
  for (const item of created) {
    shortfall.set(item.tag, (shortfall.get(item.tag) ?? 0) + (item.most - item.fewest));
  }
  return items
    .map((item) => {
      const gap = shortfall.get(item.tag) ?? 0;
      return gap > 0 ? `${item.amount - gap}-${item.amount} ${item.tag}` : `${item.amount} ${item.tag}`;
    })
    .join(", ");
}

/**
 * The ITEMS cell's hover: what the report said, what came from an unverifiable source, what this
 * month's production adds, what a `BUY ALL` settled to and what stopped it settling higher, what
 * stopped production short, and what could not be counted - in that order, known before unknown
 * (`ah-agbm`, `ah-ofpb.1`, `ah-jown`).
 *
 * `silver` is the row's own forecast, which is where the cap sentence and the `BUY ALL` sentences
 * live: the ITEMS and SILVER hovers say them in the same words because they call the same
 * functions. `undefined` when there is nothing to say, exactly today's behaviour for a cell the
 * orders left alone (`ah-agbm`).
 */
export function itemsTooltip(
  unit: PreviewedUnit | undefined,
  silver?: UnitSilver | null
): string | undefined {
  if (!unit) {
    return undefined;
  }

  const change = changeFor(unit, "items");
  const takenUnshown = unit.takenUnshown ?? [];
  const produced = unit.produced ?? [];
  const built = unit.built ?? [];
  const created = unit.created ?? [];
  const uncounted = unit.uncounted ?? [];
  const transportSent = unit.transportSent ?? [];
  const transportReceived = unit.transportReceived ?? [];
  const buyAll = buyAllSentences(silver);
  const capSentence = productionCapSentence(silver);
  const menSentence = productionMenSentence(silver);
  const castCap = castCapSentence(silver);
  if (
    !change &&
    takenUnshown.length === 0 &&
    produced.length === 0 &&
    built.length === 0 &&
    created.length === 0 &&
    uncounted.length === 0 &&
    transportSent.length === 0 &&
    transportReceived.length === 0 &&
    buyAll.length === 0 &&
    capSentence === undefined &&
    menSentence === undefined &&
    castCap === undefined
  ) {
    return undefined;
  }

  // In the navigator's S1 state - a unit whose only order cannot be counted - nothing was
  // projected, so the report's own list is still true and gives line 3's wording something to
  // follow. Deliberately the same "was:" wording as a real change, not a second sentence for the
  // same fact.
  const original = change ? change.original : formatItems(unit.items);
  const lines = [`was: ${original === "" ? "—" : original}`];
  for (const taken of takenUnshown) {
    lines.push(
      `Includes ${taken.amount} ${taken.tag} taken from unit ${taken.from}, which your report does not show here.`
    );
  }
  for (const item of produced) {
    lines.push(
      `Includes ${item.amount} ${item.tag} this unit will produce. Production resolves last, so they cannot be spent this month.`
    );
  }
  for (const sentence of buyAll) {
    lines.push(sentence);
  }
  for (const item of created) {
    const amount = item.fewest === item.most ? `${item.most}` : `${item.fewest}-${item.most}`;
    const verb = item.summoned ? "summon" : "create by casting";
    lines.push(
      `Includes ${amount} ${item.tag} this unit will ${verb}. Casting resolves after GIVE, so they cannot be given away this month.`
    );
  }
  for (const arrival of transportReceived) {
    lines.push(
      `Includes ${arrival.amount} ${arrival.tag} transported from unit ${arrival.from}. Transport resolves last, so they cannot be spent this month.`
    );
  }
  // Before the cap sentence, because that one quotes "the N its skill and tools could make" and this one is
  // what explains why N is what it is (`ah-qct4`) - the same order the SILVER hover reads in.
  if (menSentence !== undefined) {
    lines.push(menSentence);
  }
  if (capSentence !== undefined) {
    lines.push(capSentence);
  }
  for (const spend of built) {
    const place = spend.founding ? `a new ${spend.place}` : spend.place;
    const target =
      spend.helping === null ? `on ${place}` : `helping unit ${spend.helping} build ${place}`;
    lines.push(`Spends ${spend.amount} ${spend.tag} ${target} this month.`);
    if (spend.cappedBy === "materials") {
      lines.push(
        `This unit has ${spend.name} for ${spend.amount} units of work, not the ${spend.couldDo} its men could do.`
      );
    } else if (spend.cappedBy === "needs") {
      const needs = spend.founding
        ? `A new ${spend.place} needs ${spend.amount} units of work`
        : `${spend.place} needs ${spend.amount} more units of work`;
      lines.push(`${needs}, not the ${spend.couldDo} its men could do.`);
    }
  }
  if (castCap !== undefined) {
    lines.push(castCap);
  }
  for (const sent of transportSent) {
    if (sent.refused) {
      lines.push(`The game will not transport ${sent.tag}, so they stay with this unit.`);
    } else if (sent.toUnshown) {
      lines.push(
        `Sends ${sent.amount} ${sent.tag} to unit ${sent.to}, which your report does not show.`
      );
    } else {
      lines.push(`Sends ${sent.amount} ${sent.tag} to unit ${sent.to}.`);
    }
  }
  for (const order of uncounted) {
    lines.push(`and more that cannot be counted: ${order}`);
  }
  return lines.join("\n");
}

/**
 * The hover text for a changed cell. An original the report never had - no structure, no flags -
 * reads as absence rather than as a blank the eye would miss.
 */
export function originalTooltip(change: FieldChange | undefined): string | undefined {
  if (!change) {
    return undefined;
  }
  return `was: ${change.original === "" ? "—" : change.original}`;
}
