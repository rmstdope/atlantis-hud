import type { ReportUnit, SkillInfo } from "@atlantis/core-client";
import { skillEntryId, type GameDataIndex } from "./gameData";
import type { MagicPrerequisite, MagicSkillNode, MagicTree } from "./magicTree";

/**
 * Where one mage stands in the magic study tree, as a pure function of a report unit and the tree.
 *
 * `rules/magic_skills`: magic skills "cannot be learnt to a higher level than the skills they
 * depend upon" - so a prerequisite is a permanent ceiling and not merely a gate to begin, and
 * "known at 3" and "stuck at 3" are different statements. Nothing here formats anything: the
 * strings, the colours and the region label all belong to the components above.
 *
 * `crates/core/src/orders/completion.rs:401-418` does the "may begin" half of this arithmetic in
 * Rust for order completion. It is deliberately not reused: it answers a different question, has
 * no notion of a ceiling or of a maximum, and lives behind the `CoreAdapter` boundary.
 */

/** Where one mage stands in one magic skill. */
export type SkillStanding =
  /** Studied, and a prerequisite still allows more. */
  | { kind: "known"; level: number; ceiling: number }
  /** Studied, and cannot rise until one of `heldBy` does. */
  | { kind: "ceiling"; level: number; ceiling: number; heldBy: readonly MagicPrerequisite[] }
  /** Studied to `maxLevel`. Nothing is holding it back; it is finished. */
  | { kind: "maxed"; level: number }
  /** Never studied, and every prerequisite is met. */
  | { kind: "open"; ceiling: number }
  /**
   * Never studied, and at least one prerequisite is not met.
   *
   * No ceiling, on purpose: a skill can be locked and still have a non-zero one, and the number
   * would be a promise about a skill that cannot be begun at all.
   */
  | { kind: "locked" };

export type StandingKind = SkillStanding["kind"];

/** How many skills sit in each state. Always sums to `tree.skillCount`. */
export type StandingCounts = Record<StandingKind, number>;

/** One of the faction's mages, and where he stands in every magic skill. */
export type MageStanding = {
  unitId: string;
  name: string;
  /**
   * `unit.regionId` unchanged - the core's own id, `1:7,53`. The picker turns it into something a
   * player can read with `AppShell`'s `hexLabel`; this module never formats it.
   */
  regionId: string;
  /**
   * `unit.structureId` unchanged - null when he stands in the open. What `shelterSeats` looks the
   * building up by; this module never resolves it to a kind.
   */
  structureId: string | null;
  /**
   * True when he holds a magic skill other than `MANI`. False is an apprentice:
   * `rules/magic_apprentices` says manipulation makes an apprentice, who may use a mage's items
   * but cast no spell.
   */
  adept: boolean;
  byTag: ReadonlyMap<string, SkillStanding>;
  counts: StandingCounts;
  /**
   * The skills the report printed for him, verbatim - levels *and* points.
   *
   * `byTag` answers where he stands; this is what he stands on. A projection needs the points
   * (`studySchedule.ts`), and they exist nowhere else once a `ReportUnit` has been turned into a
   * standing.
   */
  skills: readonly SkillInfo[];
  /**
   * Skills he holds that the ruleset has no entry for at all - not merely absent from the tree. A
   * non-magic skill the ruleset knows (`OBSE`, `TACT`) is absent from the tree and is not here.
   */
  missing: readonly SkillInfo[];
};

/**
 * The levels a unit holds, keyed by upper-cased tag.
 *
 * Upper-casing is not optional: a report and the ruleset do not always agree on case -
 * `crates/core/src/orders/completion.rs:401-408` matches case-insensitively for the same reason -
 * and a mage whose report writes `forc` would otherwise silently read as knowing nothing.
 */
function levelsOf(skills: readonly SkillInfo[]): Map<string, number> {
  const levels = new Map<string, number>();
  for (const skill of skills) {
    levels.set(skill.tag.toUpperCase(), skill.level);
  }
  return levels;
}

/** Every prerequisite of a skill: `buildMagicTree` splits the list into exactly these two. */
function prerequisitesOf(node: MagicSkillNode): readonly MagicPrerequisite[] {
  return [...node.within, ...node.crossing];
}

function standingIn(node: MagicSkillNode, levels: ReadonlyMap<string, number>): SkillStanding {
  const level = levels.get(node.tag) ?? 0;
  const prerequisites = prerequisitesOf(node);
  const ceiling = prerequisites.reduce(
    (lowest, need) => Math.min(lowest, levels.get(need.tag) ?? 0),
    node.maxLevel
  );

  // The order matters and the counts test is what protects it: the states overlap, and a skill at
  // its maximum is also at or above its ceiling.
  if (level >= node.maxLevel && level > 0) {
    return { kind: "maxed", level };
  }
  if (level > 0 && level >= ceiling) {
    return {
      kind: "ceiling",
      level,
      ceiling,
      heldBy: prerequisites.filter((need) => (levels.get(need.tag) ?? 0) === ceiling)
    };
  }
  if (level > 0) {
    return { kind: "known", level, ceiling };
  }
  const begun = prerequisites.every((need) => (levels.get(need.tag) ?? 0) >= need.level);
  return begun ? { kind: "open", ceiling } : { kind: "locked" };
}

/**
 * Where a mage holding `levels` stands in every magic skill. Never throws; an empty tree yields
 * all-zero counts.
 *
 * Levels rather than a `ReportUnit`, so a projection can ask the same question about a mage as he
 * will be some turns from now (`studySchedule.ts`). `standingOf` is this plus the fields a report
 * supplies. Keys must be upper-cased, for the reason `levelsOf` gives.
 */
export function standingsFrom(
  levels: ReadonlyMap<string, number>,
  tree: MagicTree
): { byTag: Map<string, SkillStanding>; counts: StandingCounts } {
  const byTag = new Map<string, SkillStanding>();
  const counts: StandingCounts = { known: 0, ceiling: 0, maxed: 0, open: 0, locked: 0 };
  for (const [tag, node] of tree.byTag) {
    const standing = standingIn(node, levels);
    byTag.set(tag, standing);
    counts[standing.kind] += 1;
  }
  return { byTag, counts };
}

/** Where `unit` stands in every magic skill. Never throws; an empty tree yields all-zero counts. */
export function standingOf(
  unit: ReportUnit,
  tree: MagicTree,
  index: GameDataIndex
): MageStanding {
  const levels = levelsOf(unit.skills);
  const { byTag, counts } = standingsFrom(levels, tree);

  return {
    unitId: unit.unitId,
    name: unit.name,
    regionId: unit.regionId,
    structureId: unit.structureId,
    adept: [...levels.keys()].some((tag) => tag !== "MANI" && tree.byTag.has(tag)),
    byTag,
    counts,
    skills: unit.skills,
    missing: unit.skills.filter((skill) => !index.byId.has(skillEntryId(skill.tag)))
  };
}

/**
 * The units holding at least one magic skill, adepts first and each group in the report's own
 * order. Empty when the report has none.
 *
 * Callers pass own units only; this does not filter on `own` itself, so it stays testable with a
 * bare list. The two groups are the picker's, and the reason is the shape of a real faction: in
 * the smoke fixture fifteen of twenty-one mages hold `manipulation 3` and nothing else.
 */
export function magesOf(
  units: readonly ReportUnit[],
  tree: MagicTree,
  index: GameDataIndex
): readonly MageStanding[] {
  const mages = units
    .filter((unit) => unit.skills.some((skill) => tree.byTag.has(skill.tag.toUpperCase())))
    .map((unit) => standingOf(unit, tree, index));
  return [...mages.filter((mage) => mage.adept), ...mages.filter((mage) => !mage.adept)];
}

/** How many magic skills a mage has studied, and how far he is along in the best of them. */
function reach(mage: MageStanding): { studied: number; highest: number } {
  let studied = 0;
  let highest = 0;
  for (const standing of mage.byTag.values()) {
    if (standing.kind === "open" || standing.kind === "locked") {
      continue;
    }
    studied += 1;
    highest = Math.max(highest, standing.level);
  }
  return { studied, highest };
}

/**
 * Which mage the tree opens on: `selectedUnitId` when that unit is among `mages`, otherwise the
 * strongest - most magic skills held, then highest single magic level, then earliest in `mages`.
 * Null when there are none.
 *
 * Not the first mage in report order: in the smoke fixture that is an apprentice with 66 of 70
 * skills locked, which is the bleakest possible first impression of a study planner.
 */
export function openingMage(
  mages: readonly MageStanding[],
  selectedUnitId: string | null
): MageStanding | null {
  const selected = mages.find((mage) => mage.unitId === selectedUnitId);
  if (selected !== undefined) {
    return selected;
  }
  let best: { mage: MageStanding; studied: number; highest: number } | null = null;
  for (const mage of mages) {
    const { studied, highest } = reach(mage);
    if (
      best === null ||
      studied > best.studied ||
      (studied === best.studied && highest > best.highest)
    ) {
      best = { mage, studied, highest };
    }
  }
  return best?.mage ?? null;
}
