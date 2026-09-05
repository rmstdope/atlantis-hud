/**
 * Which hidden resources a hex's report can be read to say something about.
 *
 * Nine resources in New Origins are hidden until a unit with the right skill stands in the hex and
 * looks (`data/skills`, and `rules/region_resources` for which terrain may hold which). Without
 * this, a hex proved empty by a skilled unit reads exactly like one nobody ever checked.
 */

import type { ReportRegion } from "@atlantis/core-client";
import { itemEntryId, type GameDataIndex, type RevealingSkill } from "./gameData";
import type { RememberedResource } from "./resourceMemory";

/** What the faction actually knows about one hidden resource in one hex. */
export type ResourceCheck = {
  /** The item's tag, e.g. `FLOA`. */
  tag: string;
  /**
   * The name the mark shows: the proving report's own name for a `present` mark (`floater hides`),
   * the catalogue's singular for everything else (`floater hide`). The report names only what it
   * found, so an absence has no name of its own.
   */
  name: string;
  /**
   * `present` - an earlier turn proved this hex holds it. Only ever from memory: a resource this
   *   turn's report names is a product and gets no mark at all.
   * `absent` - proved to hold none, this turn or in an earlier one.
   * `unchecked` - nobody who could tell has ever stood here.
   */
  state: "present" | "absent" | "unchecked";
  /** How many the proving report named. `0` for `absent` and `unchecked`. */
  amount: number;
  /**
   * The turn that proved it, or `null` when this turn's own report did. Never `null` for `present`;
   * always `null` for `unchecked`.
   */
  provedOn: number | null;
  /** What settles it: the skill, its display name, and the level it takes. */
  skill: RevealingSkill;
};

/**
 * The hidden resources this hex's report can be read to say something about: what earlier turns
 * proved present first, then what is proved absent, then the gaps.
 *
 * `remembered` and `viewedTurn` are optional and default to knowing nothing, so
 * `resourceChecksOf(region, index)` still means exactly what it meant before `ah-tgtp`.
 *
 * Empty whenever the catalogue cannot say - no index, no `terrainResources`, no `revealedBy` - so a
 * ruleset generated before `ah-rx0r.1` leaves the Products line exactly as it is today.
 */
export function resourceChecksOf(
  region: ReportRegion,
  index: GameDataIndex | null,
  remembered: ReadonlyMap<string, RememberedResource> = new Map(),
  viewedTurn: number | null = null
): readonly ResourceCheck[] {
  if (index === null) {
    return [];
  }
  // The report's own terrain word, verbatim, and it includes `nexus`, which the rules table does
  // not list. A terrain the table does not name has nothing to say.
  const candidates = index.terrainResources.get(region.terrain.toLowerCase().trim()) ?? [];
  const named = new Set(region.products.map((product) => product.tag.toUpperCase()));

  const present: ResourceCheck[] = [];
  const absent: ResourceCheck[] = [];
  const unchecked: ResourceCheck[] = [];
  for (const tag of candidates) {
    const skill = index.revealedBy.get(tag);
    // Iron and wood are in the terrain list too, and nobody needs telling a mountain might hold
    // iron: only a resource some skill has to reveal is ever marked.
    if (skill === undefined || named.has(tag)) {
      continue;
    }
    const id = itemEntryId(index, tag);
    const name = id === null ? undefined : index.byId.get(id)?.name;
    if (name === undefined) {
      continue;
    }
    // `own === true` is exact: ownership is the report's `*`/`-` marker and is never inferred, so a
    // stranger's expertise can never become your faction's knowledge. The level test is `>=`
    // because abilities accrue with level - a HUNT 5 unit has not lost HUNT 3's eye.
    const looked = region.units.some(
      (unit) =>
        unit.own === true &&
        unit.skills.some(
          (held) => held.tag.toUpperCase() === skill.skillTag && held.level >= skill.level
        )
    );
    if (looked) {
      // This turn's report is the newer evidence and beats anything remembered - the direction
      // `crates/core/src/report/import.rs` already takes for a hex seen twice.
      absent.push({ tag, name, state: "absent", amount: 0, provedOn: null, skill });
      continue;
    }
    // A player looking at turn 23 with turn 39 imported must not be shown what turn 39 taught. A
    // report with no turn number has nothing better to go on, so it uses every verdict.
    const entry = remembered.get(tag);
    if (entry === undefined || (viewedTurn !== null && entry.turn > viewedTurn)) {
      unchecked.push({ tag, name, state: "unchecked", amount: 0, provedOn: null, skill });
      continue;
    }
    if (entry.amount > 0) {
      // A presence has a name from a real report, and it is the truthful one: `8 floater hides`,
      // not the catalogue's ungrammatical singular.
      present.push({
        tag,
        name: entry.name ?? name,
        state: "present",
        amount: entry.amount,
        provedOn: entry.turn,
        skill
      });
      continue;
    }
    absent.push({ tag, name, state: "absent", amount: 0, provedOn: entry.turn, skill });
  }
  // Most known to least: presences, then absences, then the gaps, each group in
  // `rules/region_resources`' own column order. A live absence and a remembered one are one group.
  return [...present, ...absent, ...unchecked];
}
