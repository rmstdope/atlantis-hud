/**
 * What the Army export dialog decides, kept apart from how it looks.
 *
 * Third of the ah-1mpx family and the one the whole family exists for: an Army leaves the
 * application as a JSON battle file the simulator at <https://atlantis.pekle.lv> loads.
 *
 * The format was established by reading the simulator's own bundle rather than its published
 * example. Three facts about it are bound into the functions below and are the reason each is
 * shaped as it is:
 *
 * 1. The loader **requires both `attackers` and `defenders` keys**. Missing either and it refuses
 *    the whole file with `Failed to parse the json, check json formatting!`.
 * 2. It accepts two shapes and sniffs which it was handed. We emit the simulator-native one, and
 *    **`skills` is always an array, even when empty** - on its own that guarantees the sniff picks
 *    the native branch.
 * 3. **Unrecognised skill and item abbreviations are dropped silently.** Nothing here tries to
 *    predict that; a file that loads is not a file that carried everything.
 *
 * Pure, like `mapExport.ts` beside it: no React, no store, no clock.
 */

import type { ArmyMemberRecord, ArmyRecord } from "@atlantis/core-client";

import { memberIsStale } from "./armies";

/** One unit as the simulator's own format wants it. */
export type BattleUnit = {
  /** `Name (number)` - what makes two units called "Scouts" tellable apart in the simulator. */
  name: string;
  /** Always present, even when empty: it is one of the keys the loader sniffs the format by. */
  skills: { abbr: string; level: number }[];
  items: { abbr: string; amount: number }[];
  /** Omitted entirely when the unit is not behind; `behind` is the only flag the simulator reads. */
  flags?: string[];
  /** Omitted entirely when the unit has no combat spell. */
  combatSpell?: string;
};

/** One side of the battle. */
export type BattleSide = { units: BattleUnit[] };

/** The whole file. Both keys are always present - the loader refuses it otherwise. */
export type BattleFile = { attackers: BattleSide; defenders: BattleSide };

/** Silver is money rather than equipment, and the simulator has nothing to do with it. */
const SILVER_TAG = "SILV";

/** The one flag the simulator reads, as the parser writes it (`crates/core/src/report/unit.rs`). */
const BEHIND_FLAG = "behind";

/** One remembered member as the simulator wants it. */
export function battleUnitOf(member: ArmyMemberRecord): BattleUnit {
  const unit: BattleUnit = {
    name: `${member.name} (${member.unitId})`,
    skills: member.skills.map((skill) => ({ abbr: skill.tag, level: skill.level })),
    items: member.items
      .filter((item) => item.tag !== SILVER_TAG)
      .map((item) => ({ abbr: item.tag, amount: item.amount }))
  };

  // Written as omissions rather than empty values: the simulator reads what is there, and an
  // empty `flags` or a null `combatSpell` says something neither of us means.
  if (member.flags.includes(BEHIND_FLAG)) {
    unit.flags = [BEHIND_FLAG];
  }
  if (member.combatSpell !== null) {
    unit.combatSpell = member.combatSpell.tag;
  }

  return unit;
}

/** An Army's members in the order it holds them; `{ units: [] }` for a side nobody is on. */
export function battleSideOf(army: ArmyRecord | null): BattleSide {
  return { units: army === null ? [] : army.members.map(battleUnitOf) };
}

/** Both sides. Both keys are always present - the loader refuses the file otherwise. */
export function battleFileOf(
  attackers: ArmyRecord | null,
  defenders: ArmyRecord | null
): BattleFile {
  return { attackers: battleSideOf(attackers), defenders: battleSideOf(defenders) };
}

/** The file's text, indented as `gameBackup.ts` writes its own. */
export function battleFileText(file: BattleFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * An Army's name as a file-name fragment: lower case, every run of anything else one `-`.
 *
 * `gameBackup.ts`'s `backupFileName` has the same intent and is deliberately not reused: it
 * preserves case and spaces, is welded to its own `.atlantis-hud-game.json` suffix, and its
 * character class is not exported. This is the intent, not the code.
 */
function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug === "" ? "army" : slug;
}

/** `northern-host-vs-coastal-watch.json`, or `northern-host.json` when one side is empty. */
export function battleFileName(
  attackers: ArmyRecord | null,
  defenders: ArmyRecord | null
): string {
  const names = [attackers, defenders].filter((army): army is ArmyRecord => army !== null);
  return `${names.map((army) => slugOf(army.name)).join("-vs-") || "army"}.json`;
}

/** The header line after a written file. `exported Northern Host vs Coastal Watch`. */
export function exportedStatus(
  attackers: ArmyRecord | null,
  defenders: ArmyRecord | null
): string {
  const names = [attackers, defenders]
    .filter((army): army is ArmyRecord => army !== null)
    .map((army) => army.name);
  return `exported ${names.join(" vs ")}`;
}

/** Which caveat a notice is; it chooses the marker's colour and nothing else. */
export type NoticeKind = "remembered" | "foreign" | "empty-side";

/** One line under the count. */
export type ExportNotice = { kind: NoticeKind; text: string };

export type ExportReadiness = {
  /** Units the file would hold, across both sides. Zero whenever `refusal` is set. */
  count: number;
  /** The sentence above the notices, or null when `refusal` is set and there is no count to give. */
  countText: string | null;
  /** The one thing standing in the way, or null. `Export…` is disabled whenever this is set. */
  refusal: string | null;
  /** The caveats, in order. Empty when there is nothing to say. */
  notices: ExportNotice[];
};

const NOTHING_TO_EXPORT: ExportReadiness = {
  count: 0,
  countText: null,
  refusal: null,
  notices: []
};

/**
 * Everything the dialog says below its two pickers, decided in one place.
 *
 * An Army chosen on **both** sides is not special-cased anywhere: the file carries it twice, so it
 * is counted twice, and its remembered and foreign members are counted twice too.
 */
export function exportReadiness(args: {
  armies: readonly ArmyRecord[];
  attackers: ArmyRecord | null;
  defenders: ArmyRecord | null;
  /** `parsed.header.turnNumber`. The dialog is not reachable while this is null - see the strip. */
  currentTurn: number;
}): ExportReadiness {
  const { armies, attackers, defenders, currentTurn } = args;

  const refusal = refusalFor(armies, attackers, defenders);
  if (refusal !== null) {
    return { ...NOTHING_TO_EXPORT, refusal };
  }

  // Both sides' members, in the order the file writes them. An Army on both sides appears twice,
  // which is why this is a list rather than a set.
  const members = [attackers, defenders].flatMap((army) => (army === null ? [] : army.members));
  const count = members.length;

  const remembered = members.filter((member) => memberIsStale(member, currentTurn)).length;
  const foreign = members.filter((member) => !member.own).length;

  const notices: ExportNotice[] = [];
  if (remembered > 0) {
    notices.push({ kind: "remembered", text: rememberedText(remembered, count) });
  }
  if (foreign > 0) {
    notices.push({ kind: "foreign", text: foreignText(foreign) });
  }
  if (attackers === null) {
    notices.push({ kind: "empty-side", text: "The attacking side will be empty." });
  } else if (defenders === null) {
    notices.push({ kind: "empty-side", text: "The defending side will be empty." });
  }

  return {
    count,
    countText: `${count} unit${count === 1 ? "" : "s"} will be exported.`,
    refusal: null,
    notices
  };
}

/** The three refusals, in their precedence. Only ever one at a time. */
function refusalFor(
  armies: readonly ArmyRecord[],
  attackers: ArmyRecord | null,
  defenders: ArmyRecord | null
): string | null {
  if (armies.length === 0) {
    return "No Armies to export. Make an Army first, then come back.";
  }
  if (attackers === null && defenders === null) {
    return "Choose at least one Army.";
  }

  // The attacker is named first when both are empty: it is the side the dialog opened on.
  const emptyArmy = [attackers, defenders].find(
    (army) => army !== null && army.members.length === 0
  );
  return emptyArmy === undefined || emptyArmy === null
    ? null
    : `${emptyArmy.name} has no units in it.`;
}

function rememberedText(remembered: number, count: number): string {
  if (remembered === 1) {
    return "1 unit was not in this turn's report. It goes out as it was when last seen.";
  }
  const all = remembered === count ? "All " : "";
  return `${all}${remembered} units were not in this turn's report. They go out as they were when last seen.`;
}

function foreignText(foreign: number): string {
  return foreign === 1
    ? "1 unit belongs to another faction. It goes out with its men and equipment but no skills — a report never shows you those."
    : `${foreign} units belong to another faction. They go out with their men and equipment but no skills — a report never shows you those.`;
}
