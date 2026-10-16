/**
 * Every faction the loaded reports know, as the command palette lists them (ah-mlls.3).
 *
 * A pure function so its rules are tested here rather than through the palette, which `packages/shared`
 * can only render statically (`testing/README.md`, ah-nass).
 */

import type { KnownUnitSighting, ParsedReport, ReportUnit } from "@atlantis/core-client";
import { ATLACLIENT_SOURCE_ID } from "./atlaClientImport";
import { attitudeToward } from "./factionDossier";
import type { HexKnowledge } from "./hexMapModel";

/** The part of a map hex that holds units, which is all either reader of the map needs. */
export type MemoryHex = {
  regionId: string;
  knowledge: HexKnowledge;
  rememberedUnits: readonly KnownUnitSighting[];
  /**
   * This turn's detail, for a `current` hex. A merged ally's hexes reach this turn's map only here:
   * the merge writes them into the stored map (`crates/core/src/report/merge.rs`), never into
   * `parsed`, so a reader of `parsed.regions` alone misses the units they show.
   */
  region?: { units: readonly ReportUnit[] } | null;
};

/**
 * Units on this turn's map that `parsed` does not hold - those a merged ally's report shows - so
 * "seen this turn" means the map the player is looking at, not just their own report.
 */
export function mergedUnits(parsed: ParsedReport, hexes: readonly MemoryHex[]): ReportUnit[] {
  const own = new Set(parsed.regions.map((region) => region.regionId));
  return hexes.flatMap((hex) =>
    hex.knowledge === "current" && !own.has(hex.regionId) ? [...(hex.region?.units ?? [])] : []
  );
}

export type PaletteFaction = {
  factionId: string;
  /** Null when nothing loaded names them; the row then reads `Unnamed faction (<id>)`. */
  name: string | null;
  own: boolean;
  /** An ally whose report is merged into this turn. */
  merged: boolean;
  /** As `attitudeToward` reads it; null for the player's own faction or when nothing is declared. */
  attitude: string | null;
  /**
   * The latest turn memory saw one of their units - set only when none of their units is in this
   * turn's report, which is when the row says `last seen turn <n>`.
   */
  lastSeenTurn?: number;
};

/**
 * One row per faction, in the palette's order: the player's own; then this turn's, as the report
 * gives them - the declared attitudes as printed, the owners of the units it shows, the allies
 * merged in; then those known only from memory, in map order.
 *
 * A unit concealing its faction (`factionId: null`) names nobody. Only stale hexes are memory: a
 * hex this turn's report covers is already read from the report itself.
 */
export function paletteFactions(input: {
  parsed: ParsedReport | null;
  merged: readonly { mergedFactionId: string; mergedFactionName: string }[];
  hexes: readonly MemoryHex[];
}): PaletteFaction[] {
  const { parsed } = input;
  // No report, no rows: memory alone has no turn to be "earlier" than (ah-mlls.3, the states).
  if (parsed === null) {
    return [];
  }
  const attitudes = parsed.header.attitudes ?? null;
  const ownId = parsed.header.factionId ?? null;
  const order: string[] = [];
  const names = new Map<string, string | null>();
  const mergedIds = new Set<string>();
  const thisTurnUnits = new Set<string>();
  const lastSeen = new Map<string, number>();

  const note = (factionId: string, name: string | null) => {
    if (!names.has(factionId)) {
      order.push(factionId);
      names.set(factionId, name);
    } else if (names.get(factionId) === null && name !== null) {
      names.set(factionId, name);
    }
  };

  if (ownId !== null) {
    note(ownId, parsed.header.factionName ?? null);
  }
  for (const level of attitudes?.levels ?? []) {
    for (const faction of level.factions) {
      note(faction.id, faction.name);
    }
  }
  for (const unit of [...parsed.regions.flatMap((region) => region.units), ...mergedUnits(parsed, input.hexes)]) {
    if (unit.factionId !== null) {
      note(unit.factionId, unit.factionName);
      thisTurnUnits.add(unit.factionId);
    }
  }
  for (const record of input.merged) {
    if (record.mergedFactionId !== ATLACLIENT_SOURCE_ID) {
      note(record.mergedFactionId, record.mergedFactionName);
      mergedIds.add(record.mergedFactionId);
    }
  }
  for (const hex of input.hexes) {
    if (hex.knowledge !== "stale") {
      continue;
    }
    for (const sighting of hex.rememberedUnits) {
      const factionId = sighting.unit.factionId;
      if (factionId === null) {
        continue;
      }
      note(factionId, sighting.unit.factionName);
      lastSeen.set(factionId, Math.max(lastSeen.get(factionId) ?? sighting.lastSeenTurn, sighting.lastSeenTurn));
    }
  }

  return order.map((factionId) => {
    const own = factionId === ownId;
    const turn = thisTurnUnits.has(factionId) ? undefined : lastSeen.get(factionId);
    return {
      factionId,
      name: names.get(factionId) ?? null,
      own,
      merged: mergedIds.has(factionId),
      attitude: own ? null : attitudeToward(attitudes, factionId),
      ...(turn === undefined ? {} : { lastSeenTurn: turn })
    };
  });
}
