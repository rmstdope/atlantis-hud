/**
 * The rules of an assistant's write to an Army (ah-mjiv1).
 *
 * The assistant may make an Army from units the report shows, and change only an Army it made
 * itself - for good, even after the player edits it by hand. Every refusal throws a sentence for the
 * model and changes nothing. Plain functions, testable without a window (ah-nass).
 */

import type { ArmyMemberRecord, ArmyRecord, ReportUnit } from "@atlantis/core-client";
import { newArmy, withMember, withoutMember } from "../armies";

/** One side of an Army's Before/After: what the panel compares and Revert puts back. */
export type ArmySide = { readonly name: string; readonly members: readonly ArmyMemberRecord[] };

export function sideOf(army: ArmyRecord): ArmySide {
  return { name: army.name, members: army.members };
}

/**
 * Whether two sides say the same about an Army: its name and which units it holds.
 *
 * Snapshots are left out on purpose - a turn load refreshes them, and that is not an edit. `null` is
 * no Army at all.
 */
export function sameSide(a: ArmySide | null, b: ArmySide | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  const ids = new Set(a.members.map((member) => member.unitId));
  return (
    a.name === b.name &&
    a.members.length === b.members.length &&
    b.members.every((member) => ids.has(member.unitId))
  );
}

/** The key two Army names are compared by: what `export_battle_file` finds an Army by. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function distinct(unitIds: readonly string[], what: string): void {
  const seen = new Set<string>();
  for (const unitId of unitIds) {
    if (seen.has(unitId)) {
      throw new Error(`Unit ${unitId} is named twice ${what}; give each unit once.`);
    }
    seen.add(unitId);
  }
}

function shownUnits(unitIds: readonly string[], units: ReadonlyMap<string, ReportUnit>): ReportUnit[] {
  return unitIds.map((unitId) => {
    const unit = units.get(unitId);
    if (unit === undefined) {
      throw new Error(`This turn's report shows no unit ${unitId}; nothing was changed.`);
    }
    return unit;
  });
}

/** A new Army of `unitIds`, marked as the assistant's. Throws a sentence when it may not be made. */
export function createAssistantArmy(input: {
  armies: readonly ArmyRecord[];
  gameId: string;
  name: string;
  unitIds: readonly string[];
  units: ReadonlyMap<string, ReportUnit>;
  turn: number;
  now: string;
}): ArmyRecord {
  const { armies, gameId, name, unitIds, units, turn, now } = input;
  if (name.trim() === "") {
    throw new Error("An Army needs a name.");
  }
  const taken = armies.find((army) => nameKey(army.name) === nameKey(name));
  if (taken !== undefined) {
    throw new Error(`"${taken.name}" is already an Army's name in this game; choose another.`);
  }
  if (unitIds.length === 0) {
    throw new Error("An Army needs at least one unit.");
  }
  distinct(unitIds, "");
  const members = shownUnits(unitIds, units);
  const army = { ...newArmy({ gameId, name, now }), madeByAssistant: true };
  return members.reduce((one, unit) => withMember(one, unit, turn, now), army);
}

/** `army` with `add` taken in and `remove` let go. Throws a sentence when it may not be changed. */
export function changeAssistantArmy(input: {
  army: ArmyRecord;
  add: readonly string[];
  remove: readonly string[];
  units: ReadonlyMap<string, ReportUnit>;
  turn: number;
  now: string;
}): ArmyRecord {
  const { army, add, remove, units, turn, now } = input;
  if (army.madeByAssistant !== true) {
    throw new Error(`"${army.name}" is an Army the player built; only Armies you made can be changed. Make your own with create_army.`);
  }
  if (add.length === 0 && remove.length === 0) {
    throw new Error("Name units to add or remove.");
  }
  distinct(add, "to add");
  distinct(remove, "to remove");
  const both = add.find((unitId) => remove.includes(unitId));
  if (both !== undefined) {
    throw new Error(`Unit ${both} is named to add and to remove; name it once.`);
  }
  const members = new Set(army.members.map((member) => member.unitId));
  const missing = remove.find((unitId) => !members.has(unitId));
  if (missing !== undefined) {
    throw new Error(`Unit ${missing} is not in "${army.name}"; nothing was changed.`);
  }
  const added = shownUnits(add, units);
  const lessened = remove.reduce((one, unitId) => withoutMember(one, unitId, now), army);
  return added.reduce((one, unit) => withMember(one, unit, turn, now), { ...lessened, updatedAt: now });
}
