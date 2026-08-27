import type { SkillInfo } from "@atlantis/core-client";
import type { GameDataIndex, GameDataLink } from "./gameData";

/** A skill a unit must already have, at a level, before it may begin another. */
export type MagicPrerequisite = {
  /** The dictionary id, e.g. `skill:FORC`. */
  id: string;
  tag: string;
  name: string;
  level: number;
};

/** One magic skill as a branch card draws it. */
export type MagicSkillNode = {
  id: string;
  tag: string;
  name: string;
  /** The highest level the game allows in this skill. 5 for every magic skill in the shipped ruleset. */
  maxLevel: number;
  /** Longest path to a root. 0 for FORC, PATT, SPIR and MANI. Drives indentation. */
  depth: number;
  /** The key of the branch this skill is filed under. */
  branch: string;
  /** Prerequisites filed under the same branch. Rendered as the dim gate text. */
  within: readonly MagicPrerequisite[];
  /** Prerequisites from another branch. Rendered as the crossing chips. */
  crossing: readonly MagicPrerequisite[];
};

export type MagicBranch = {
  /** `FOUND`, `DIRECT`, `MANI`, or a one-step skill's tag such as `ARTI`. */
  key: string;
  title: string;
  /** The one-step skill the branch is named for; null for `FOUND` and `DIRECT`. */
  rootTag: string | null;
  /** The sentence under the title, or null for a computed branch. */
  blurb: string | null;
  /** In render order: shallowest first, then by name. */
  skills: readonly MagicSkillNode[];
};

export type MagicTree = {
  /** In render order. */
  branches: readonly MagicBranch[];
  byTag: ReadonlyMap<string, MagicSkillNode>;
  /** Always the number of magic skills, for the header count. */
  skillCount: number;
};

/** The three branches whose title and blurb are written rather than taken from a skill. */
const FOUNDATIONS = "FOUND";
const DIRECT = "DIRECT";
const APPRENTICESHIP = "MANI";

const NAMED_BRANCHES: Readonly<Record<string, { title: string; blurb: string }>> = {
  [FOUNDATIONS]: {
    title: "The foundations",
    blurb: "Studied first. Everything else stands on these."
  },
  [DIRECT]: {
    title: "Straight from a foundation",
    blurb: "One step from a foundation, and nothing further needs them."
  },
  [APPRENTICESHIP]: {
    title: "Apprenticeship",
    blurb:
      "Not a foundation, and nothing builds on it: manipulation makes an apprentice, who may use a mage's items but cast no spell."
  }
};

/** What the index holds about one magic skill, before any of it is derived. */
type RawMagicSkill = {
  id: string;
  tag: string;
  name: string;
  maxLevel: number;
  requires: readonly GameDataLink[];
};

/**
 * The magic skills the index holds, keyed by tag.
 *
 * `GameDataEntry` does not carry `magic` - only the `"skill"` variant of `detailOf` does - so the
 * detail is asked for per entry rather than the entries being filtered on their own. `ANNI` is
 * `magic: false` in the ruleset on purpose (`data/ANNI`: it cannot be studied by normal means) and
 * is therefore absent from everything below, which is correct and must stay so.
 */
function magicSkillsOf(index: GameDataIndex): Map<string, RawMagicSkill> {
  const skills = new Map<string, RawMagicSkill>();
  for (const entry of index.entries) {
    if (entry.category !== "skill" || entry.tag === null) {
      continue;
    }
    const detail = index.detailOf(entry.id);
    if (detail === null || detail.kind !== "skill" || !detail.magic) {
      continue;
    }
    skills.set(entry.tag, {
      id: entry.id,
      tag: entry.tag,
      name: entry.name,
      maxLevel: detail.maxLevel,
      requires: detail.requires
    });
  }
  return skills;
}

/**
 * The prerequisites of `skill` that are themselves magic skills, upper-cased.
 *
 * No prerequisite in the shipped ruleset points at a non-magic skill, so this filter changes
 * nothing there - it is what keeps the walk total on a ruleset where one does.
 */
function magicRequires(
  skill: RawMagicSkill,
  skills: ReadonlyMap<string, RawMagicSkill>
): { tag: string; level: number }[] {
  return skill.requires
    .map((link) => ({ tag: link.id.slice("skill:".length).toUpperCase(), level: link.level }))
    .filter((requirement) => skills.has(requirement.tag));
}

/**
 * Longest path to a root, memoised. A skill with no magic prerequisite is 0.
 *
 * The longest path rather than the shortest because a prerequisite is a floor: `CRRI` needs
 * `ARTI 2` (depth 1) and `INVI 3` (depth 2), and it is the deeper of the two that says how far
 * into the tree it really sits.
 */
function depthsOf(skills: ReadonlyMap<string, RawMagicSkill>): Map<string, number> {
  const depths = new Map<string, number>();
  const walk = (tag: string, seen: ReadonlySet<string>): number => {
    const known = depths.get(tag);
    if (known !== undefined) {
      return known;
    }
    const skill = skills.get(tag);
    // A cycle cannot arise from the shipped ruleset, but a scrape is not a proof: `seen` keeps the
    // walk total rather than letting one recurse until the stack gives out.
    if (skill === undefined || seen.has(tag)) {
      return 0;
    }
    const below = new Set(seen).add(tag);
    const requirements = magicRequires(skill, skills);
    const depth =
      requirements.length === 0
        ? 0
        : 1 + Math.max(...requirements.map((requirement) => walk(requirement.tag, below)));
    depths.set(tag, depth);
    return depth;
  };
  for (const tag of skills.keys()) {
    walk(tag, new Set<string>());
  }
  return depths;
}

/**
 * Which branch card each skill is filed under, before the one-skill branches are merged.
 *
 * A root is a foundation, except `MANI`, which is set apart because it is not one: `rules/magic_
 * foundations` names only force, pattern and spirit, and `rules/magic_apprentices` says
 * manipulation makes an apprentice rather than a mage. A one-step skill names its own branch;
 * anything deeper takes the branch of its **first** prerequisite - not its deepest - which is what
 * files the twenty-five `create X` skills under `ARTI`, since `ARTI` leads each of their lists.
 */
function branchesOf(
  skills: ReadonlyMap<string, RawMagicSkill>,
  depths: ReadonlyMap<string, number>
): Map<string, string> {
  const branches = new Map<string, string>();
  const walk = (tag: string, seen: ReadonlySet<string>): string => {
    const known = branches.get(tag);
    if (known !== undefined) {
      return known;
    }
    const skill = skills.get(tag);
    if (skill === undefined || seen.has(tag)) {
      return FOUNDATIONS;
    }
    const depth = depths.get(tag) ?? 0;
    if (depth === 0) {
      const branch = tag === APPRENTICESHIP ? APPRENTICESHIP : FOUNDATIONS;
      branches.set(tag, branch);
      return branch;
    }
    if (depth === 1) {
      branches.set(tag, tag);
      return tag;
    }
    const first = magicRequires(skill, skills)[0];
    const branch =
      first === undefined ? FOUNDATIONS : walk(first.tag, new Set(seen).add(tag));
    branches.set(tag, branch);
    return branch;
  };
  for (const tag of skills.keys()) {
    walk(tag, new Set<string>());
  }
  return branches;
}

/** `artifact lore` reads as `Artifact lore` - the skill's own name, not title case per word. */
function branchTitle(name: string): string {
  return name === "" ? name : name[0].toUpperCase() + name.slice(1);
}

/**
 * The magic skills of `index`, grouped into branch cards.
 *
 * Returns a tree with no branches when the index holds no magic skills, which is what a ruleset
 * scraped before `magic` was added looks like. Never throws.
 */
export function buildMagicTree(index: GameDataIndex): MagicTree {
  const skills = magicSkillsOf(index);
  const depths = depthsOf(skills);
  const branches = branchesOf(skills, depths);

  // A branch holding one skill is a one-step skill nothing further builds on, and ten cards of one
  // line each say less than one card of ten. `MANI` is exempt: it is set apart on purpose.
  const sizes = new Map<string, number>();
  for (const branch of branches.values()) {
    sizes.set(branch, (sizes.get(branch) ?? 0) + 1);
  }
  const filedUnder = (tag: string): string => {
    const branch = branches.get(tag) ?? FOUNDATIONS;
    return branch !== APPRENTICESHIP && sizes.get(branch) === 1 ? DIRECT : branch;
  };

  const byTag = new Map<string, MagicSkillNode>();
  for (const skill of skills.values()) {
    const depth = depths.get(skill.tag) ?? 0;
    const branch = filedUnder(skill.tag);
    const within: MagicPrerequisite[] = [];
    const crossing: MagicPrerequisite[] = [];
    for (const requirement of magicRequires(skill, skills)) {
      const required = skills.get(requirement.tag);
      const prerequisite: MagicPrerequisite = {
        id: required?.id ?? `skill:${requirement.tag}`,
        tag: requirement.tag,
        name: required?.name ?? requirement.tag,
        level: requirement.level
      };
      // A one-step skill's prerequisites are foundations, whose branch is never its own - so by the
      // branch test alone every one of them would cross, and `illusion` would read as two chips
      // rather than as the gate text `FORC 1, PATT 1`. Standing on the foundations is what a
      // one-step skill *is*, so none of it crosses anywhere.
      const crosses = depth > 1 && filedUnder(requirement.tag) !== branch;
      (crosses ? crossing : within).push(prerequisite);
    }
    byTag.set(skill.tag, {
      id: skill.id,
      tag: skill.tag,
      name: skill.name,
      maxLevel: skill.maxLevel,
      depth,
      branch,
      within,
      crossing
    });
  }

  const grouped = new Map<string, MagicSkillNode[]>();
  for (const node of byTag.values()) {
    const list = grouped.get(node.branch) ?? [];
    list.push(node);
    grouped.set(node.branch, list);
  }

  const cards: MagicBranch[] = [];
  for (const [key, nodes] of grouped) {
    const named = NAMED_BRANCHES[key];
    const rootTag = named === undefined ? key : null;
    cards.push({
      key,
      title: named?.title ?? branchTitle(byTag.get(key)?.name ?? key),
      rootTag,
      blurb: named?.blurb ?? null,
      skills: nodes.sort((left, right) => left.depth - right.depth || left.name.localeCompare(right.name))
    });
  }

  // The foundations open, because everything stands on them; the branches then run largest first,
  // which puts artifact lore's twenty-six beside the eye rather than after eight small cards; and
  // the two collections close, `DIRECT` before the apprenticeship that is set apart from all of it.
  const rank = (branch: MagicBranch) =>
    branch.key === FOUNDATIONS ? 0 : branch.key === DIRECT ? 2 : branch.key === APPRENTICESHIP ? 3 : 1;
  cards.sort(
    (left, right) =>
      rank(left) - rank(right) ||
      right.skills.length - left.skills.length ||
      left.title.localeCompare(right.title)
  );

  return { branches: cards, byTag, skillCount: byTag.size };
}

/**
 * Which of `skills` the tree should open on for a mage: highest level, then most points, then
 * whichever the report listed first. Null when the unit holds no magic skill.
 *
 * The tag is upper-cased before it is looked up. A report and the ruleset do not always agree on
 * case - `crates/core/src/orders/completion.rs` matches case-insensitively for the same reason -
 * and a mage whose report writes `forc` would otherwise silently get no link at all.
 *
 * The highest level rather than the deepest skill in the tree: what a mage is furthest along in is
 * what they are, and the first skill a report lists is usually a level-1 foundation.
 */
export function highestMagicSkill(
  skills: readonly SkillInfo[],
  tree: MagicTree
): MagicSkillNode | null {
  let best: { node: MagicSkillNode; level: number; points: number } | null = null;
  for (const skill of skills) {
    const node = tree.byTag.get(skill.tag.toUpperCase());
    if (node === undefined) {
      continue;
    }
    if (
      best === null ||
      skill.level > best.level ||
      (skill.level === best.level && skill.points > best.points)
    ) {
      best = { node, level: skill.level, points: skill.points };
    }
  }
  return best?.node ?? null;
}
