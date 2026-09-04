import type { AlliedMageRecord, ParsedReport, SkillInfo } from "@atlantis/core-client";
import { mageSheetRows } from "./alliedMageChip";
import { factionLabelOf } from "./factionLabel";
import type { GameDataIndex } from "./gameData";
import { openingMage, standingOf, type MageStanding, type SkillStanding } from "./magicStanding";
import type { MagicSkillNode, MagicTree } from "./magicTree";
import { projectedLevel } from "./studyProgress";

/**
 * Every row, every group and every string the study planner shows (`ah-lyg6.2.2`), as pure
 * functions of a report, the allied-mage store's rows and the magic tree.
 *
 * The wording is pinned here rather than in the component because `packages/shared` has no jsdom
 * (ah-nass): a component test there renders with `renderToStaticMarkup` and can only assert
 * markup, so a sentence asserted in a `.test.ts` beside this file is a sentence that stays put.
 *
 * **Read-only.** This bead stores nothing: no `studyPlans*` module is imported here, and choosing
 * next turn's study is `ah-lyg6.2.3`.
 */

/** The store's own status, as the planner reads it. */
export type PlannerAlliedStatus = "idle" | "loading" | "ready" | "error";

/** One magic skill a mage holds, as the detail's `Knows` draws it. */
export type KnownSkill = {
  tag: string;
  /** `MagicSkillNode.name`, verbatim and lower case, as the magic tree draws it. */
  name: string;
  level: number;
  standing: SkillStanding;
  /**
   * The level the unreported months could have reached, or null when nothing could have moved or
   * the mage is not from a stale sheet. Always greater than `level` when it is not null.
   */
  projected: number | null;
};

/** One mage in the planner: whose he is, where he stands, and how old the news about him is. */
export type PlannerMage = {
  /** `${factionId}/${unitId}` - unique across the pane, and what the selection holds. */
  key: string;
  factionId: string;
  /** The group's own label: "Borg TNG (95)", "Faction 17", or "Your faction". */
  factionLabel: string;
  unitId: string;
  name: string;
  regionId: string;
  /** `MageStanding.structureId` - the building he stands in, or null in the open. */
  structureId: string | null;
  standing: MageStanding;
  /** The sheet this mage came from, or null for one of your own out of the loaded report. */
  sheetTurn: number | null;
  /** Months of study no sheet describes: `viewedTurn - sheetTurn`, 0 for your own mages. */
  monthsUnreported: number;
  /** What he holds, strongest first. */
  knows: KnownSkill[];
  /** What he may begin now, in the tree's own order. Never projected. */
  canStudy: MagicSkillNode[];
  /**
   * The skills the report or the sheet printed for him, verbatim - levels and points.
   *
   * What a projection starts from (`studySchedule.ts`); the two views must agree about where a
   * mage stands as well as about who exists.
   */
  skills: readonly SkillInfo[];
  /** "force 4 · 12 can study": the list row's second line. */
  summary: string;
};

/** One faction's mages, and how old the news about them is. */
export type PlannerGroup = {
  factionId: string;
  /** "Borg TNG (95)", or "Faction 95", or "Your faction" when the report names none. */
  factionLabel: string;
  source: "own" | "sheet";
  /** The whole heading: "Borg TNG (95) — your faction, turn 71". */
  heading: string;
  /** True when a sheet is behind the viewed turn. Own mages are never stale. */
  stale: boolean;
  mages: PlannerMage[];
};

const OWN_FACTION_LABEL = "Your faction";

/** The skills a mage holds that the tree can draw, strongest first. */
function knownSkills(
  standing: MageStanding,
  tree: MagicTree,
  skills: readonly SkillInfo[] | null,
  monthsUnreported: number
): KnownSkill[] {
  const byTag = new Map<string, SkillInfo>();
  for (const skill of skills ?? []) {
    // Upper-cased before it is looked up: a report and the ruleset do not always agree on case,
    // and `levelsOf` upper-cases for exactly this reason.
    byTag.set(skill.tag.toUpperCase(), skill);
  }

  const rows: KnownSkill[] = [];
  for (const [tag, skillStanding] of standing.byTag) {
    if (
      skillStanding.kind !== "known" &&
      skillStanding.kind !== "ceiling" &&
      skillStanding.kind !== "maxed"
    ) {
      continue;
    }
    const node = tree.byTag.get(tag);
    if (node === undefined) {
      continue;
    }
    const reported = byTag.get(tag);
    const projection =
      reported === undefined || monthsUnreported === 0
        ? null
        : projectedLevel(reported, monthsUnreported, node.maxLevel);
    rows.push({
      tag,
      name: node.name,
      level: skillStanding.level,
      standing: skillStanding,
      projected: projection !== null && projection > skillStanding.level ? projection : null
    });
  }
  return rows.sort((a, b) => b.level - a.level || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

/** What he may begin now, walked in the tree's own render order so the list is stable. */
function openSkills(standing: MageStanding, tree: MagicTree): MagicSkillNode[] {
  return tree.branches.flatMap((branch) =>
    branch.skills.filter((skill) => standing.byTag.get(skill.tag)?.kind === "open")
  );
}

/**
 * The strongest magic skill a mage holds, from his standings.
 *
 * Not `highestMagicSkill`, which needs the report's own `SkillInfo`s: your own mages reach the
 * planner as `MageStanding`s, which carry levels and no points, and one row must read the same way
 * whoever it belongs to. Highest level, then by tag, which is the tie-break `knows` uses too.
 */
function strongest(knows: readonly KnownSkill[]): KnownSkill | null {
  return knows[0] ?? null;
}

function plannerMage(input: {
  standing: MageStanding;
  factionId: string;
  factionLabel: string;
  tree: MagicTree;
  skills: readonly SkillInfo[] | null;
  sheetTurn: number | null;
  monthsUnreported: number;
}): PlannerMage {
  const knows = knownSkills(input.standing, input.tree, input.skills, input.monthsUnreported);
  const canStudy = openSkills(input.standing, input.tree);
  const best = strongest(knows);
  const reach = best === null ? "no magic skill" : `${best.name} ${best.level}`;
  return {
    key: `${input.factionId}/${input.standing.unitId}`,
    factionId: input.factionId,
    factionLabel: input.factionLabel,
    unitId: input.standing.unitId,
    name: input.standing.name,
    regionId: input.standing.regionId,
    structureId: input.standing.structureId,
    standing: input.standing,
    sheetTurn: input.sheetTurn,
    monthsUnreported: input.monthsUnreported,
    knows,
    canStudy,
    skills: input.skills ?? input.standing.skills,
    summary: `${reach} · ${canStudy.length} can study`
  };
}

/** Every mage the player can see, your faction first, then allies oldest sheet first. */
export function plannerGroups(input: {
  /** The loaded report, for its faction label and its turn. Null before one is loaded. */
  report: ParsedReport | null;
  /** Your own mages, already standing-resolved: `AppShell`'s `mages` memo, passed straight in. */
  ownMages: readonly MageStanding[];
  alliedMages: readonly AlliedMageRecord[];
  tree: MagicTree;
  index: GameDataIndex;
  /** `report.header.turnNumber`, or null. Decides every sheet's age. */
  viewedTurn: number | null;
}): PlannerGroup[] {
  const groups: PlannerGroup[] = [];

  if (input.ownMages.length > 0) {
    const label = factionLabelOf(input.report) ?? OWN_FACTION_LABEL;
    // "Borg TNG (95) — your faction, turn 71"; "Your faction — turn 71" when the report names no
    // faction, because "Your faction — your faction" would be absurd; and either without the turn
    // when the report carries no turn number.
    const named = label !== OWN_FACTION_LABEL;
    const role = named ? " — your faction" : "";
    const turn =
      input.viewedTurn === null ? "" : `${named ? ", " : " — "}turn ${input.viewedTurn}`;
    groups.push({
      factionId: input.report?.header.factionId ?? "",
      factionLabel: label,
      source: "own",
      heading: `${label}${role}${turn}`,
      stale: false,
      mages: input.ownMages.map((standing) =>
        plannerMage({
          standing,
          factionId: input.report?.header.factionId ?? "",
          factionLabel: label,
          tree: input.tree,
          skills: null,
          sheetTurn: null,
          monthsUnreported: 0
        })
      )
    });
  }

  for (const row of mageSheetRows(input.alliedMages, input.viewedTurn)) {
    const records = input.alliedMages.filter((record) => record.factionId === row.factionId);
    groups.push({
      factionId: row.factionId,
      factionLabel: row.factionLabel,
      source: "sheet",
      heading: `${row.factionLabel} — ${row.turnText}`,
      stale: row.turnsOld > 0,
      mages: records.map((record) =>
        plannerMage({
          standing: standingOf(record.unit, input.tree, input.index),
          factionId: record.factionId,
          factionLabel: row.factionLabel,
          tree: input.tree,
          skills: record.unit.skills,
          // The faction's own row, not this record's, for both: the heading says how old the
          // news about this faction is, and a detail sentence that disagreed with the heading
          // above it would be a second answer to a question the navigator settled once.
          // `mageSheetRows` floors the age at zero, so a sheet ahead of the viewed turn is never
          // projected backwards.
          sheetTurn: row.sheetTurn,
          monthsUnreported: row.turnsOld
        })
      )
    });
  }

  return groups;
}

/** "7 mages — 3 yours, 4 from 2 allies". Null when there are none: the empty state speaks instead. */
export function plannerSummaryLine(groups: readonly PlannerGroup[]): string | null {
  const own = groups
    .filter((group) => group.source === "own")
    .reduce((count, group) => count + group.mages.length, 0);
  const allies = groups.filter((group) => group.source === "sheet");
  const allied = allies.reduce((count, group) => count + group.mages.length, 0);
  const total = own + allied;
  if (total === 0) {
    return null;
  }
  const mages = `${total} mage${total === 1 ? "" : "s"}`;
  const allyWord = `${allies.length} all${allies.length === 1 ? "y" : "ies"}`;
  if (allied === 0) {
    return `${mages}, all yours`;
  }
  if (own === 0) {
    return `${mages} from ${allyWord}`;
  }
  return `${mages} — ${own} yours, ${allied} from ${allyWord}`;
}

/** The sentence above a stale mage's detail, or null when he is not from a stale sheet. */
export function unreportedLine(mage: PlannerMage): string | null {
  if (mage.sheetTurn === null || mage.monthsUnreported === 0) {
    return null;
  }
  const turns = `${mage.monthsUnreported} turn${mage.monthsUnreported === 1 ? "" : "s"} old`;
  const months = `${mage.monthsUnreported} month${mage.monthsUnreported === 1 ? "" : "s"}`;
  return `From a mage sheet of turn ${mage.sheetTurn}, ${turns}. Up to ${months} of study since it are estimated below and marked →.`;
}

/**
 * Which mage the pane opens on, or null when there are none.
 *
 * Your own faction first, and `openingMage`'s own rule within it - the strongest rather than the
 * first, for the reason its doc comment gives. A planner that opens on somebody else's mage while
 * you have your own reads as the wrong game.
 */
export function openingPlannerMage(
  groups: readonly PlannerGroup[],
  selectedUnitId: string | null
): PlannerMage | null {
  const own = groups.find((group) => group.source === "own");
  if (own !== undefined && own.mages.length > 0) {
    const picked = openingMage(
      own.mages.map((mage) => mage.standing),
      selectedUnitId
    );
    const found = own.mages.find((mage) => mage.unitId === picked?.unitId);
    if (found !== undefined) {
      return found;
    }
  }
  for (const group of groups) {
    const selected = group.mages.find((mage) => mage.unitId === selectedUnitId);
    if (selected !== undefined) {
      return selected;
    }
  }
  return groups.flatMap((group) => group.mages)[0] ?? null;
}

/**
 * The line above the list about the allied rows themselves - loading, or failed - or null when
 * there is nothing to say. `hasOwnMages` decides whether the failure adds its second sentence.
 */
export function plannerAlliedNotice(
  status: PlannerAlliedStatus,
  hasOwnMages: boolean
): string | null {
  if (status === "loading") {
    return "Loading your allies' mages…";
  }
  if (status === "error") {
    return hasOwnMages
      ? "Your allies' mage sheets could not be read. Your own mages are listed below."
      : "Your allies' mage sheets could not be read.";
  }
  return null;
}

/**
 * What the pane says when it holds no mage at all.
 *
 * `rules/magic`: "A character enters the world of magic in Atlantis by beginning study on one of
 * the Foundation magic skills. Only one man units, with the man being a leader, are permitted to
 * study these skills." That sentence is where the second headline's detail comes from.
 */
export function plannerEmptyCopy(input: { reportLoaded: boolean }): {
  headline: string;
  detail: string;
} {
  if (!input.reportLoaded) {
    return {
      headline: "No mages yet.",
      detail:
        "Your own mages appear when a report is loaded. An ally's appear when you open a mage sheet they sent you."
    };
  }
  return {
    headline: "No mage in this faction has begun a magic skill.",
    detail: "A one-man leader unit that studies a Foundation becomes one."
  };
}
