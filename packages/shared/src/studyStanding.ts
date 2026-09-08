/**
 * Where each of your own mages stands once this month's orders have run.
 *
 * Pure, and in `packages/shared` for the reason `studyShelter.ts` gives: that package has no jsdom,
 * so everything a test needs to see lives in a module with no React in it.
 *
 * The answer is read out of the orders preview the editor already computes - `preview_orders_state`
 * advances a unit's `structureId` through this month's LEAVE, ENTER and MOVE orders in the Rust
 * core (`crates/core/src/orders/standing.rs standing_after`, pinned by
 * `effects.rs enter_and_leave_change_the_structure`). Nothing here re-derives that rule; it exists
 * in exactly one place on purpose.
 *
 * `rules/sequenceofevents` runs STUDY after movement, so a mage who walks out studies in the hex he
 * arrives in rather than the one the report found him in.
 */

import type { OrdersPreviewResponse, ParsedReport } from "@atlantis/core-client";
import type { PlannerGroup } from "./studyPlanner";
import { shelterKey } from "./studyShelter";
import { previewPairs, standingRowFor } from "./unitPreviewRows";
import { unitRowKey } from "./unitTable";

/** Where one mage stands once this month's LEAVE, ENTER and MOVE orders have run. */
export type StandingAfterOrders = {
  /**
   * The hex he studies in. `rules/sequenceofevents` runs STUDY after movement, so a mage who
   * walks out studies where he arrives, not where the report found him.
   */
  regionId: string;
  /** The structure he is inside then, or null in the open. */
  structureId: string | null;
  /**
   * True when `regionId` is a hex the loaded report does not show, so nothing can be said about
   * what stands there. Neither halved nor flagged: navigator, 2026-09-08.
   */
  offMap: boolean;
  /**
   * The building this month's orders took him out of, as `Castle [4]`, or null.
   *
   * Set when, and only when, the report has him inside a structure and his after-orders
   * `structureId` is **null** - he ends the month in the open, which is the one case a sentence is
   * shown for. A mage who walks from a Castle into a Tower, and a block holding both a LEAVE and
   * an ENTER (which ends *inside*, `rules/enter`), both leave it null.
   */
  leftBuilding: string | null;
  /**
   * How he came out: `"move"` when his hex changed, `"leave"` otherwise. Null alongside a null
   * `leftBuilding`. Read from the hex rather than from the order text, because the preview states
   * the hex and the order text would have to be re-parsed.
   */
  leftBy: "move" | "leave" | null;
};

/**
 * One entry per own mage whose standing this month's orders change; absent means unchanged.
 *
 * Keyed by `PlannerMage.key` (`${factionId}/${unitId}`). Only your own mages can appear: you hold
 * no orders document for an ally, so an ally's mage is read from his sheet exactly as before.
 */
export function standingAfterOrders(input: {
  groups: readonly PlannerGroup[];
  /** `AppShell`'s `ordersPreview`; null while it is still being computed, or when there are none. */
  preview: OrdersPreviewResponse | null;
  /** The loaded report, for which hexes are known and what each structure is called. */
  report: ParsedReport | null;
  /** `shelterNames(report)` - `shelterKey(regionId, structureId)` to the report's own name. */
  names: ReadonlyMap<string, string>;
}): ReadonlyMap<string, StandingAfterOrders> {
  const out = new Map<string, StandingAfterOrders>();
  const { preview, report } = input;
  if (preview === null || report === null) {
    // Today's behaviour, and the right thing during the 300 ms debounce: every mage falls back to
    // the report's own snapshot.
    return out;
  }

  const known = new Set(report.regions.map((region) => region.regionId));

  // The preview lists only what the orders change, so a mage with no row keeps the report's answer.
  // One unit can have two rows: a `departing` one in the hex it leaves and an `arriving` one in the
  // hex it reaches. Which of the two stands for him is `unitPreviewRows` decision, made once for
  // every reader of a preview (`ah-sdjy`); STUDY runs after movement, so the one meant here is
  // where the month `ends` for him.
  // An `arriving` row with no departure to pair it with, and a departure whose arrival is missing,
  // are both half a response: the core pushes the two rows together, so neither reaches a real
  // preview. Neither is followed - the first keeps the report's snapshot, the second reads as
  // off-map - and both are pinned below rather than left to be discovered.
  const pairs = previewPairs(preview);

  for (const group of input.groups) {
    if (group.source !== "own") {
      continue;
    }
    for (const mage of group.mages) {
      const pair = pairs.get(unitRowKey(mage.regionId, mage.unitId));
      if (pair === undefined) {
        // The orders touch nothing of his: the report's own snapshot stands.
        continue;
      }
      const ends = standingRowFor(pair, "ends");

      if (ends === null) {
        // Only a `departing` row: he walks somewhere the report cannot show, so nothing can be said
        // about what stands there. `regionId` is the hex he left, because the destination is not
        // one the preview names - no consumer reads it while `offMap` is true, and it is the only
        // hex there is to give.
        out.set(mage.key, {
          regionId: mage.regionId,
          structureId: null,
          offMap: true,
          leftBuilding: null,
          leftBy: null
        });
        continue;
      }

      if (!known.has(ends.regionId)) {
        // He ends the month in a hex the report does not show. `structureId` is dropped rather than
        // carried: whatever the preview says stands there, nothing can be said about its seats, so
        // an `offMap` standing means the same thing however he got there.
        out.set(mage.key, {
          regionId: ends.regionId,
          structureId: null,
          offMap: true,
          leftBuilding: null,
          leftBy: null
        });
        continue;
      }
      const from = mage.structureId;
      const leaves = from !== null && ends.row.unit.structureId === null;
      out.set(mage.key, {
        regionId: ends.regionId,
        structureId: ends.row.unit.structureId,
        offMap: false,
        leftBuilding: leaves
          ? `${input.names.get(shelterKey(mage.regionId, from)) ?? "building"} [${from}]`
          : null,
        leftBy: leaves ? (ends.regionId === mage.regionId ? "leave" : "move") : null
      });
    }
  }

  return out;
}
