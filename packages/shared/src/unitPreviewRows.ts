/**
 * The one reader that pairs a mover's two preview rows, so nobody else has to choose between them.
 *
 * The Rust core emits a moving unit **twice**: an `arriving` row filed under the destination hex and
 * a `departing` row filed under the origin, pushed as a pair inside one branch
 * (`crates/core/src/orders/effects.rs`). Which of the two stands for the unit this month used to be
 * decided in three places with three answers, and a plan that reasoned about one source was silently
 * wrong about the other (`ah-ehgy`, `ah-tguk`, `ah-zpq3`). Here the choice is made once and named:
 * a caller cannot reach a row without saying whether it means where the unit **set out** or where
 * the month **ends** for it.
 *
 * Pure - no React, no DOM - for the same reason `unitPreview.ts` and `studyStanding.ts` are.
 */

import type { OrdersPreviewResponse, UnitPreview } from "@atlantis/core-client";
import { unitRowKey, type UnitRowKey } from "./unitTable";

/** Which of a mover's two preview rows a caller means. */
export type PreviewRowChoice = "set-out" | "ends";

/**
 * One preview row, with the hex it was listed under.
 *
 * The hex comes from `RegionPreview.regionId` rather than from `row.unit.regionId`: the core files
 * every row under the hex it belongs to and sets `unit.region_id` to match (`effects.rs`), so the
 * two always agree in production - but the region id is the authoritative grouping key, and
 * `studyStanding.test.ts` builds rows with no `unit.regionId` at all.
 */
export type PlacedRow = { regionId: string; row: UnitPreview };

/** A unit's preview rows, with the departing/arriving choice made once and named. */
export type PreviewPair = {
  /** The row in the hex the report gave the unit: `present`, or `departing` for a mover. */
  setOut: PlacedRow;
  /** The `arriving` row paired with `setOut`, or null when the response holds none. */
  ends: PlacedRow | null;
};

/**
 * How an arrival is found from the departure that names it: the unit, the origin, the destination.
 *
 * The separator is a NUL, which no region id or unit id can contain, so no pair of inputs can
 * produce the same key as a different pair - the same reason `unitRowKey` uses one.
 */
function arrivalKey(unitId: string, from: string, to: string): string {
  return [unitId, from, to].join("\u0000");
}

/**
 * Every non-`arriving` row of a preview, each paired with its arrival, in the preview's own order.
 *
 * Keyed by `unitRowKey(regionId, unitId)` of the `setOut` row - on the hex as well as the number,
 * because a formed unit's alias (`new-1`) is reused hex by hex and two of them can share an id in
 * one response (`ah-4hux`).
 *
 * An `arriving` row whose departure is missing is dropped, exactly as `mergePreviewAcross` dropped
 * every arrival before this module existed. The order is the response's own - regions in order, and
 * units in order within each - because `foldIn` appends rows the report has no place for in that
 * order and tests pin it.
 */
export function previewPairs(
  preview: OrdersPreviewResponse | null | undefined
): ReadonlyMap<UnitRowKey, PreviewPair> {
  const regions = preview?.regions ?? [];

  const arrivals = new Map<string, PlacedRow>();
  for (const region of regions) {
    for (const row of region.units) {
      if (row.status === "arriving" && row.arrivingFrom !== null && row.arrivingFrom !== undefined) {
        arrivals.set(arrivalKey(row.unit.unitId, row.arrivingFrom, region.regionId), {
          regionId: region.regionId,
          row
        });
      }
    }
  }

  const pairs = new Map<UnitRowKey, PreviewPair>();
  for (const region of regions) {
    for (const row of region.units) {
      if (row.status === "arriving") {
        continue;
      }
      const to = row.departingTo;
      const ends =
        to === null || to === undefined
          ? null
          : (arrivals.get(arrivalKey(row.unit.unitId, region.regionId, to)) ?? null);
      pairs.set(unitRowKey(region.regionId, row.unit.unitId), {
        setOut: { regionId: region.regionId, row },
        ends
      });
    }
  }

  return pairs;
}

/**
 * The row that stands for this unit under `choice`, or null when there is none.
 *
 * `"ends"` gives the arrival, else the `setOut` row when it is one the unit stays in - a lone
 * `departing` row means the month leaves it somewhere the preview does not name, which is the
 * off-map case `studyStanding` reads.
 */
export function standingRowFor(
  pair: PreviewPair | undefined,
  choice: PreviewRowChoice
): PlacedRow | null {
  if (pair === undefined) {
    return null;
  }
  if (choice === "set-out") {
    return pair.setOut;
  }
  if (pair.ends !== null) {
    return pair.ends;
  }
  return pair.setOut.row.status === "departing" ? null : pair.setOut;
}
