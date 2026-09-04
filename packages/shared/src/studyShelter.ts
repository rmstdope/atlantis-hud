/**
 * Where a mage's shelter comes from, and how many mages a building seats.
 *
 * Pure, in the shape `studySchedule.ts` and `magicStanding.ts` have and for the same reason:
 * `packages/shared` has no jsdom, so everything a test needs to see lives in a module with no
 * React in it.
 *
 * `rules/magic_skills`: "study into a magic skill above level 2 requires that the mage be located
 * in some sort of building which can offer specific facilities for mages ... If the mage is not in
 * such a structure, his study rate is cut in half". `data/objects` for a Hermits hut - "This
 * structure will allow one mage to study above level 2" - is the sentence the ruleset scraped into
 * `buildings.<NAME>.mages`, which is what this reads.
 */

import type { ParsedReport } from "@atlantis/core-client";
import { structureEntryId, type GameDataIndex } from "./gameData";

/**
 * How many mages each structure seats, keyed `${regionId}/${structureId}`.
 *
 * `null` means **not known** rather than none: the report does not list that structure, or the
 * catalogue has no entry for its kind. A number - zero included - is a fact. The difference is
 * load-bearing: an unknown shelter must not halve a mage's study, because inventing a pessimistic
 * date out of ignorance is exactly the failure H2 was chosen to avoid.
 */
export type ShelterSeats = ReadonlyMap<string, number | null>;

/** The key `ShelterSeats` is read by. A null `structureId` never has an entry: he is in the open. */
export function shelterKey(regionId: string, structureId: string): string {
  return `${regionId}/${structureId}`;
}

/**
 * Every structure the loaded report shows, and the mages it seats.
 *
 * An unfinished building seats nobody: `rules/buildings` is silent, and the Rust core takes the
 * same line (`semantics.rs:9607-9645`, `structure.needs.is_some()` yields no shelter).
 *
 * `structure.baseKind` and not `structure.kind`: `StructureInfo` documents `kind` as the kind with
 * its qualifiers (`Lair, closed to player units`) and `baseKind` as the kind alone.
 */
export function shelterSeats(input: {
  report: ParsedReport | null;
  index: GameDataIndex | null;
}): ShelterSeats {
  const seats = new Map<string, number | null>();
  const { report, index } = input;
  if (report === null || index === null) {
    return seats;
  }
  for (const region of report.regions) {
    for (const structure of region.structures) {
      const key = shelterKey(region.regionId, structure.structureId);
      if (structure.needs !== null) {
        seats.set(key, 0);
        continue;
      }
      const detail = index.detailOf(structureEntryId(index, structure.baseKind));
      if (detail === null || detail.kind === "absent") {
        // The catalogue never scraped this kind, so nothing can be said about it - and a mage must
        // not lose half a month on the strength of that silence.
        seats.set(key, null);
        continue;
      }
      seats.set(key, detail.kind === "building" ? detail.mages : 0);
    }
  }
  return seats;
}
