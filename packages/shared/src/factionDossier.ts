import type { DeclaredAttitudes, ParsedReport } from "@atlantis/core-client";
import type { MemoryHex } from "./paletteFactions";

/** One hex a faction has been seen in this turn, and how many of its units stand there. */
export type DossierHex = {
  regionId: string;
  unitCount: number;
};

/** One unit of the faction, and the hex it stands in. */
export type DossierUnit = {
  unitId: string;
  name: string;
  regionId: string;
};

/** One hex older reports remember the faction's units in (ah-mlls.3). */
export type LastSeenHex = {
  regionId: string;
  /** The latest turn one of their units was remembered there. */
  lastSeenTurn: number;
  unitCount: number;
};

/** Everything this turn's report knows about one faction. */
export type FactionDossier = {
  id: string;
  /** As the attitudes block prints it, falling back to the name its units carry, then to the id. */
  name: string;
  /** As declared toward them, or `null` when neither the block nor a default names them. */
  attitude: string | null;
  /** Hexes holding at least one of their units, in report order. */
  hexes: DossierHex[];
  units: DossierUnit[];
  /**
   * Where memory last saw their units, most recent first - filled only when none of their units is
   * in this turn's report, which is when the panel says `Last seen` instead of `Seen in`.
   */
  lastSeen: LastSeenHex[];
};

/**
 * What is known, and only what is known.
 *
 * Two limits the panel states out loud (ah-bu2c), because an empty-looking faction otherwise reads
 * as "they have nothing" rather than "we cannot see anything":
 *
 * - "Seen in" means "has a unit in *this turn's* report". There is no memory of earlier turns.
 * - A foreign unit that conceals its faction has `factionId: null` (`ReportUnit.ts`), so it belongs
 *   to no dossier at all - not even the right one.
 */
export function dossierFor(
  parsed: ParsedReport,
  attitudes: DeclaredAttitudes | null,
  factionId: string,
  memory: readonly MemoryHex[] = []
): FactionDossier {
  const hexes: DossierHex[] = [];
  const units: DossierUnit[] = [];
  let reportName: string | null = null;

  for (const region of parsed.regions) {
    // factionId is null for a concealed unit; `=== factionId` excludes those without a special case.
    const mine = region.units.filter((unit) => unit.factionId === factionId);
    if (mine.length === 0) {
      continue;
    }
    hexes.push({ regionId: region.regionId, unitCount: mine.length });
    for (const unit of mine) {
      units.push({ unitId: unit.unitId, name: unit.name, regionId: unit.regionId });
      reportName ??= unit.factionName;
    }
  }

  const recalled = units.length === 0 ? recall(memory, factionId) : { name: null, lastSeen: [] };

  return {
    id: factionId,
    // "Unnamed faction" rather than the bare number, so the panel reads as the palette row that
    // opened it does: `Unnamed faction (95)` (ah-mlls.3).
    name: declaredName(attitudes, factionId) ?? reportName ?? recalled.name ?? "Unnamed faction",
    attitude: attitudeToward(attitudes, factionId),
    hexes,
    units,
    lastSeen: recalled.lastSeen
  };
}

/**
 * What memory holds of a faction: the hexes older reports remember its units in, and a name.
 *
 * Stale hexes only - a hex this turn's report covers is read from the report, and its remembered
 * units are no longer where they were. Sorted most recent first; a stable sort keeps map order
 * among hexes of the same turn.
 */
function recall(
  memory: readonly MemoryHex[],
  factionId: string
): { name: string | null; lastSeen: LastSeenHex[] } {
  let name: string | null = null;
  const lastSeen: LastSeenHex[] = [];
  for (const hex of memory) {
    if (hex.knowledge !== "stale") {
      continue;
    }
    const theirs = hex.rememberedUnits.filter((sighting) => sighting.unit.factionId === factionId);
    if (theirs.length === 0) {
      continue;
    }
    for (const sighting of theirs) {
      name ??= sighting.unit.factionName;
    }
    lastSeen.push({
      regionId: hex.regionId,
      lastSeenTurn: Math.max(...theirs.map((sighting) => sighting.lastSeenTurn)),
      unitCount: theirs.length
    });
  }
  return { name, lastSeen: lastSeen.sort((a, b) => b.lastSeenTurn - a.lastSeenTurn) };
}

/** The name the attitudes block prints for the faction, which is the one the reader clicked. */
function declaredName(attitudes: DeclaredAttitudes | null, factionId: string): string | null {
  for (const level of attitudes?.levels ?? []) {
    const named = level.factions.find((faction) => faction.id === factionId);
    if (named) {
      return named.name;
    }
  }
  return null;
}

/**
 * The level the faction is named at, or the declared default, or nothing at all.
 *
 * Exported because the units dock's `Other factions` strip names the attitude too (`ah-1mpx.5`).
 * Do not write a second copy: this one already falls back to the declared default.
 */
export function attitudeToward(attitudes: DeclaredAttitudes | null, factionId: string): string | null {
  for (const level of attitudes?.levels ?? []) {
    if (level.factions.some((faction) => faction.id === factionId)) {
      return level.attitude;
    }
  }
  return attitudes?.defaultAttitude ?? null;
}
