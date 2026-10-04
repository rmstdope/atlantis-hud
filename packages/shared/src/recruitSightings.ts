/**
 * Which races the player's reports have seen offered for sale, region by region, across every
 * loaded turn (ah-yu3j.1).
 *
 * The game data never ties a race to a terrain, so the game data dialog's terrain page answers
 * "who can I recruit here?" from what the player's own reports have shown instead: every race any
 * loaded turn offered for sale in a region, each region counted once however many turns saw it.
 *
 * Nothing is persisted. Like `resourceMemory.ts`, whose scan it rides on, it is rebuilt from
 * `imported_turns.raw_report` whenever a game opens.
 *
 * Pure: no React, no store, no client.
 */

import type { ParsedReport } from "@atlantis/core-client";
import type { GameDataIndex } from "./gameData";

/** One region as its turns have shown it: its terrain word, and every race seen for sale there. */
export type RecruitSighting = { terrain: string; races: ReadonlySet<string> };

/** Every region's sighting, by region id. Race tags are upper-cased item tags. */
export type RecruitSightings = ReadonlyMap<string, RecruitSighting>;

/** Nothing seen. Exported so callers need not build an empty Map each render. */
export const NO_RECRUIT_SIGHTINGS: RecruitSightings = new Map();

/** A race as the terrain page lists it: a link to its Men entry and how many regions sold it. */
export type RaceSeen = { id: string; name: string; regions: number };

/**
 * One turn folded in. Returns a new map; `sightings` is never mutated. Returns `sightings` itself,
 * by identity, when `index` is null - without the catalogue nothing tells a race from grain.
 */
export function withRecruitTurn(
  sightings: RecruitSightings,
  report: ParsedReport,
  index: GameDataIndex | null
): RecruitSightings {
  if (index === null) {
    return sightings;
  }
  const next = new Map(sightings);
  for (const region of report.regions) {
    const races = region.forSale
      .map((item) => item.tag.toUpperCase())
      .filter((tag) => index.byId.has(`man:${tag}`));
    if (races.length === 0) {
      continue;
    }
    add(next, region.regionId, region.terrain.trim().toLowerCase(), races);
  }
  return next;
}

/** Two sightings as one: the union of every region's races. Neither input is written to. */
export function mergedRecruitSightings(
  existing: RecruitSightings,
  incoming: RecruitSightings
): RecruitSightings {
  const next = new Map(existing);
  for (const [regionId, sighting] of incoming) {
    add(next, regionId, sighting.terrain, sighting.races);
  }
  return next;
}

/** The races seen for sale in regions of `terrain`, most regions first, then by name. */
export function racesSeenIn(
  sightings: RecruitSightings,
  terrain: string,
  index: GameDataIndex
): RaceSeen[] {
  const wanted = terrain.trim().toLowerCase();
  const regionsByRace = new Map<string, number>();
  for (const sighting of sightings.values()) {
    if (sighting.terrain !== wanted) {
      continue;
    }
    for (const race of sighting.races) {
      regionsByRace.set(race, (regionsByRace.get(race) ?? 0) + 1);
    }
  }
  return [...regionsByRace]
    .map(([tag, regions]) => {
      const id = `man:${tag}`;
      return { id, name: index.byId.get(id)?.name ?? tag, regions };
    })
    .sort((a, b) => b.regions - a.regions || a.name.localeCompare(b.name));
}

/** A region's races joined onto what is held, into a fresh set so nothing handed out changes. */
function add(
  into: Map<string, RecruitSighting>,
  regionId: string,
  terrain: string,
  races: Iterable<string>
): void {
  const held = into.get(regionId);
  into.set(regionId, { terrain, races: new Set([...(held?.races ?? []), ...races]) });
}
