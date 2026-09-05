/**
 * What earlier turns proved about a hex's hidden resources, remembered across turns.
 *
 * `ah-rx0r.2` reads *this* turn's units, in *this* hex, now - so the moment the hunter marches away
 * a proved absence reverts to an unknown gap, and a hex proved rich reverts to a question mark.
 * Both halves are wrong: an advanced resource is a durable fact about the hex, not about the unit
 * standing in it. This module is where that knowledge is folded together.
 *
 * Nothing is persisted. `imported_turns.raw_report` already keeps every turn's text, so the whole
 * memory is rebuilt by a scan whenever a game opens - the shape `battleSkillsStore.ts` documents
 * for battle rosters, a second time.
 *
 * Pure, like `battleSkills.ts` beside it: no React, no store, no client, no clock.
 */

import type { ParsedReport } from "@atlantis/core-client";
import type { GameDataIndex } from "./gameData";

/** What one turn's report proved about one hidden resource in one hex. */
export type RememberedResource = {
  /** The item's tag, e.g. `FLOA`. */
  tag: string;
  /** How many that report named. `0` is a proved absence, which is the point of the bead. */
  amount: number;
  /**
   * The report's own name for the item, exactly as it printed it (`floater hides`). `null` when the
   * report named none, which has no name of its own.
   */
  name: string | null;
  /** The turn whose report proved it. */
  turn: number;
};

/** Every hex's remembered verdicts: region id, then item tag, then the newest verdict. */
export type ResourceMemory = ReadonlyMap<string, ReadonlyMap<string, RememberedResource>>;

/** Nothing remembered. Exported so callers need not build an empty Map each render. */
export const NO_RESOURCE_MEMORY: ResourceMemory = new Map();

/** The same empty map every time, so a render passing it as a prop does not churn its identity. */
const NO_REMEMBERED: ReadonlyMap<string, RememberedResource> = new Map();

/** The verdicts remembered for one hex. The same empty map every time, so it is safe as a prop. */
export function rememberedFor(
  memory: ResourceMemory,
  regionId: string
): ReadonlyMap<string, RememberedResource> {
  return memory.get(regionId) ?? NO_REMEMBERED;
}

/**
 * One turn folded in. Returns a new map; `memory` is never mutated. Returns `memory` itself, by
 * identity, when `index` is `null` - nothing can be judged without the catalogue.
 *
 * The merge rule is `battleSkills.ts`': a verdict replaces the one held when its turn is greater
 * than **or equal to** the incumbent's, so a re-scan is idempotent, the fold order cannot change
 * the answer, and two factions' reports of the same turn settle deterministically on the later-read
 * one.
 */
export function withTurn(
  memory: ResourceMemory,
  report: ParsedReport,
  turn: number,
  index: GameDataIndex | null
): ResourceMemory {
  if (index === null) {
    return memory;
  }

  const next = copyOf(memory);
  for (const region of report.regions) {
    // The report's own terrain word, verbatim, and it includes `nexus`, which the rules table does
    // not list. A terrain the table does not name has nothing to say.
    const candidates = index.terrainResources.get(region.terrain.toLowerCase().trim()) ?? [];
    for (const tag of candidates) {
      const skill = index.revealedBy.get(tag);
      // Only a resource some skill has to reveal is ever remembered: nobody needs telling that a
      // mountain might hold iron.
      if (skill === undefined) {
        continue;
      }
      // `own === true` is exact, as in `resourceChecks.ts`: a stranger's expertise never becomes
      // your faction's knowledge. `>=` because abilities accrue with level.
      const looked = region.units.some(
        (unit) =>
          unit.own === true &&
          unit.skills.some(
            (held) => held.tag.toUpperCase() === skill.skillTag && held.level >= skill.level
          )
      );
      // A tag nobody looked for is not written: this turn says nothing about it, which is a
      // different thing from saying there are none.
      if (!looked) {
        continue;
      }
      const named = region.products.find((product) => product.tag.toUpperCase() === tag);
      remember(next, region.regionId, {
        tag,
        amount: named?.amount ?? 0,
        name: named?.name ?? null,
        turn
      });
    }
  }
  return next;
}

/**
 * Two memories folded together, the greater turn winning each hex-and-tag and `incoming` winning a
 * tie. What the scan needs to land its answer without discarding the turn the shell folded in while
 * it was running - the job `mergedDerived` does for the battle-roster scan (`battleSkills.ts`).
 */
export function mergedMemory(existing: ResourceMemory, incoming: ResourceMemory): ResourceMemory {
  const next = copyOf(existing);
  for (const [regionId, verdicts] of incoming) {
    for (const verdict of verdicts.values()) {
      remember(next, regionId, verdict);
    }
  }
  return next;
}

/** A mutable copy, one level deep, so nothing handed out is ever written to again. */
function copyOf(memory: ResourceMemory): Map<string, Map<string, RememberedResource>> {
  const copy = new Map<string, Map<string, RememberedResource>>();
  for (const [regionId, verdicts] of memory) {
    copy.set(regionId, new Map(verdicts));
  }
  return copy;
}

/** One verdict written under the merge rule: at least as new as the incumbent wins. */
function remember(
  memory: Map<string, Map<string, RememberedResource>>,
  regionId: string,
  verdict: RememberedResource
): void {
  let verdicts = memory.get(regionId);
  if (verdicts === undefined) {
    verdicts = new Map<string, RememberedResource>();
    memory.set(regionId, verdicts);
  }
  const held = verdicts.get(verdict.tag);
  if (held === undefined || held.turn <= verdict.turn) {
    verdicts.set(verdict.tag, verdict);
  }
}
