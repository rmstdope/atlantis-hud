/**
 * Which hidden resources a hex's report can be read to say something about.
 *
 * Nine resources in New Origins are hidden until a unit with the right skill stands in the hex and
 * looks (`data/skills`, and `rules/region_resources` for which terrain may hold which). Without
 * this, a hex proved empty by a skilled unit reads exactly like one nobody ever checked.
 */

import type { ReportRegion } from "@atlantis/core-client";
import { itemEntryId, type GameDataIndex, type RevealingSkill } from "./gameData";

/** What the faction actually knows about one hidden resource in one hex. */
export type ResourceCheck = {
  /** The item's tag, e.g. `FLOA`. */
  tag: string;
  /**
   * The catalogue's name, e.g. `floater hide`. The report names only what it found, so an absence
   * has no name of its own and the catalogue's singular is the only one there is.
   */
  name: string;
  /**
   * `absent` - an own unit standing here carries the skill, and the Products line named none.
   * `unchecked` - no own unit standing here could tell either way.
   */
  state: "absent" | "unchecked";
  /** What settles it: the skill, its display name, and the level it takes. */
  skill: RevealingSkill;
};

/**
 * The hidden resources this hex's report can be read to say something about, absences first.
 *
 * Empty whenever the catalogue cannot say - no index, no `terrainResources`, no `revealedBy` - so a
 * ruleset generated before `ah-rx0r.1` leaves the Products line exactly as it is today.
 */
export function resourceChecksOf(
  region: ReportRegion,
  index: GameDataIndex | null
): readonly ResourceCheck[] {
  if (index === null) {
    return [];
  }
  // The report's own terrain word, verbatim, and it includes `nexus`, which the rules table does
  // not list. A terrain the table does not name has nothing to say.
  const candidates = index.terrainResources.get(region.terrain.toLowerCase().trim()) ?? [];
  const named = new Set(region.products.map((product) => product.tag.toUpperCase()));

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
    (looked ? absent : unchecked).push({
      tag,
      name,
      state: looked ? "absent" : "unchecked",
      skill
    });
  }
  // Absences first, then the gaps, each group in `rules/region_resources`' own column order.
  return [...absent, ...unchecked];
}
