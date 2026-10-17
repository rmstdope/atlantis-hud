/**
 * A merged report's units, laid over the turn they belong to (`ah-oqxn`).
 *
 * Merging a second faction's report of the same turn keeps every unit that report lists on the
 * merge's own record (`MergedReportRecord.units`), exactly as the report wrote them. A report states
 * skills and a full inventory for its own units only, and large items of anyone else's
 * (`rules/reportformat`), so the merged faction's *own* units are the ones it knows better than the
 * player does. This module is every rule for using that:
 *
 * - On the merged turn, each of the merged faction's own units replaces the player's sighting of
 *   it, marked with where it came from - and never as ours: `own` stays `false`, so nothing that
 *   offers orders or prices a month ever treats it as the player's.
 * - Every other unit the merged report saw is added where the player has no row for it, as an
 *   ordinary foreign row; the player's own account of a stranger is never replaced.
 * - On a later turn, only the skills come forward, stamped with the merged turn, the way
 *   battle-recovered skills already do (`battleSkills.ts`).
 *
 * Pure, because `packages/shared` has no jsdom (`ah-nass`, `.cerebro/traps.md`): the table, the map
 * and the Unit panel read this module's answers, and every rule is pinned on it.
 */

import type { KnownMap, MergedReportRecord, ParsedReport, ReportUnit } from "@atlantis/core-client";
import { mergedDerived, NO_DERIVED_SKILLS, type DerivedSkill, type DerivedSkills } from "./battleSkills";
import { foreignUnitsIn } from "./workspace/foreignUnits";
import { mergedFactionLabel } from "./workspace/mergedFactionLabel";
import type { MergedUnit } from "./mergedFrom";

export { mergedBandText, mergedFromOf, mergedMarkTitle, type MergedFrom, type MergedUnit } from "./mergedFrom";

/** The units to lay over one turn, split into the ones that replace a row and the ones that only add. */
type Laid = {
  /** Every merged faction's own units, marked, by unit number. */
  marked: ReadonlyMap<string, MergedUnit>;
  /** Every unit to add where no row has its number, in record and report order. */
  added: readonly ReportUnit[];
};

/**
 * What the merges of `turn` lay over it, or null when none apply.
 *
 * Own units of every record go first, so a faction's own account of a unit beats another merged
 * report's sighting of it whichever was merged first.
 */
function laidOver(records: readonly MergedReportRecord[], turn: number | null): Laid | null {
  const applying = turn === null ? [] : records.filter((record) => record.turnNumber === turn);
  if (applying.every((record) => record.units.length === 0)) {
    return null;
  }

  const marked = new Map<string, MergedUnit>();
  for (const record of applying) {
    const from = { factionLabel: mergedFactionLabel(record), turn: record.turnNumber };
    for (const unit of record.units) {
      if (unit.own && !marked.has(unit.unitId)) {
        marked.set(unit.unitId, { ...unit, own: false, mergedFrom: from });
      }
    }
  }

  const added: ReportUnit[] = [];
  const seen = new Set<string>();
  for (const record of applying) {
    for (const unit of record.units) {
      if (seen.has(unit.unitId)) {
        continue;
      }
      seen.add(unit.unitId);
      added.push(marked.get(unit.unitId) ?? { ...unit, own: false });
    }
  }

  return { marked, added };
}

/** `unit`, or the merged faction's own account of it when one was laid over this turn. */
function replaced(unit: ReportUnit, laid: Laid): ReportUnit {
  return unit.own ? unit : (laid.marked.get(unit.unitId) ?? unit);
}

/**
 * The `Other factions` rows for the turn on screen: the player's own foreign rows, each of a merged
 * faction's own units filled in where it stands, then every unit a merged report saw that the
 * player's report has no row for - in a hex both saw, or one only the merged faction saw.
 */
export function foreignRowsWithMerged(
  parsed: ParsedReport,
  records: readonly MergedReportRecord[]
): ReportUnit[] {
  const rows = foreignUnitsIn(parsed);
  const laid = laidOver(records, parsed.header.turnNumber);
  if (laid === null) {
    return rows;
  }

  const present = new Set<string>();
  for (const region of parsed.regions) {
    for (const unit of region.units) {
      present.add(unit.unitId);
    }
  }

  return [
    ...rows.map((unit) => replaced(unit, laid)),
    ...laid.added.filter((unit) => !present.has(unit.unitId))
  ];
}

/**
 * The known map with the merges of its own turn laid over its hexes, so the Unit panel, the region
 * panel and the map read the same units the table does. The same map, by identity, when no merge
 * of that turn kept any unit.
 *
 * A unit is added only to a hex the map has a region for: a hex the map cannot describe has no
 * list to put it in.
 */
export function knownMapWithMerged(known: KnownMap, records: readonly MergedReportRecord[]): KnownMap {
  const laid = laidOver(records, known.currentTurn);
  if (laid === null) {
    return known;
  }

  const present = new Set<string>();
  for (const hex of known.hexes) {
    for (const unit of hex.region?.units ?? []) {
      present.add(unit.unitId);
    }
  }
  const addedByRegion = new Map<string, ReportUnit[]>();
  for (const unit of laid.added) {
    if (present.has(unit.unitId)) {
      continue;
    }
    const held = addedByRegion.get(unit.regionId) ?? [];
    held.push(unit);
    addedByRegion.set(unit.regionId, held);
  }

  return {
    ...known,
    hexes: known.hexes.map((hex) => {
      const region = hex.region;
      if (region === null) {
        return hex;
      }
      return {
        ...hex,
        region: {
          ...region,
          units: [
            ...region.units.map((unit) => replaced(unit, laid)),
            ...(addedByRegion.get(region.regionId) ?? [])
          ]
        }
      };
    })
  };
}

/**
 * The skills merged reports of *earlier* turns state for their factions' own units, as derived
 * skills stamped with the turn each came from - what a later turn shows as `COMB 2 (turn 17)`.
 *
 * Folded under the battle skills' rule (`mergedDerived`): per unit and skill, the newer turn wins,
 * and a later record wins a tie. Nothing for the merged turn itself, which shows the whole unit,
 * nor before it.
 */
export function carriedMergedSkills(
  history: readonly MergedReportRecord[],
  turn: number | null
): DerivedSkills {
  if (turn === null) {
    return NO_DERIVED_SKILLS;
  }

  let carried: DerivedSkills = NO_DERIVED_SKILLS;
  for (const record of history) {
    if (record.turnNumber >= turn) {
      continue;
    }
    const from = mergedFactionLabel(record);
    const incoming = new Map<string, DerivedSkill[]>();
    for (const unit of record.units) {
      if (!unit.own || unit.skills.length === 0) {
        continue;
      }
      incoming.set(
        unit.unitId,
        unit.skills.map((skill) => ({
          name: skill.name.toLowerCase(),
          tag: skill.tag,
          level: skill.level,
          turn: record.turnNumber,
          coordinate: null,
          terrain: null,
          from
        }))
      );
    }
    if (incoming.size > 0) {
      carried = mergedDerived(carried, incoming);
    }
  }
  return carried;
}
