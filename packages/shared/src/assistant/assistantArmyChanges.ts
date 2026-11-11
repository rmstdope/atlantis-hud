/**
 * The Armies in the Assistant changes panel (ah-mjiv1): what is listed, what Keep and Revert do, and
 * what an entry says.
 *
 * Only the writes are recorded, as for orders (`assistantChanges`). Whether the player has edited an
 * Army since, or deleted it, is worked out from the Armies as they stand each time, so an entry always
 * follows the Army whoever moved it. Plain functions, testable without a window (ah-nass).
 */

import type { ArmyMemberRecord, ArmyRecord } from "@atlantis/core-client";
import { sameSide, sideOf, type ArmySide } from "./assistantArmies";
import { listedCount, type AlignedOrderLine, type AssistantArmyChange, type AssistantChangesState } from "./assistantChanges";

/**
 * One write to an Army folded in. `replaced` is the Army as it stood at that moment, `null` when the
 * write made it.
 *
 * If `replaced` is not what the assistant last left, the player edited the Army in between, and
 * Before becomes that edit, so Revert returns it rather than losing it.
 */
export function recordAssistantArmyWrite(
  state: AssistantChangesState,
  write: { armyId: string; replaced: ArmySide | null; wrote: ArmySide }
): AssistantChangesState {
  const { armyId, replaced, wrote } = write;
  const existing = state.armies.find((change) => change.armyId === armyId);
  const before = existing === undefined || !sameSide(replaced, existing.after) ? replaced : existing.before;
  const others = state.armies.filter((change) => change.armyId !== armyId);
  const armies = sameSide(before, wrote) ? others : [...others, { armyId, before, after: wrote }];
  return { ...state, open: listedCount(state) === 0 ? true : state.open, armies };
}

/** One Army's change accepted: it leaves the list and the Army stays as it stands. */
export function keepAssistantArmyChange(state: AssistantChangesState, armyId: string): AssistantChangesState {
  const armies = state.armies.filter((change) => change.armyId !== armyId);
  return armies.length === state.armies.length ? state : { ...state, armies };
}

/** Takes off every Army the player deleted or put back to Before; the same state if there are none. */
export function settleAssistantArmyChanges(state: AssistantChangesState, current: readonly ArmyRecord[]): AssistantChangesState {
  const byId = new Map(current.map((army) => [army.id, army]));
  const armies = state.armies.filter((change) => stillListed(change, byId.get(change.armyId)));
  return armies.length === state.armies.length ? state : { ...state, armies };
}

function stillListed(change: AssistantArmyChange, army: ArmyRecord | undefined): boolean {
  return army !== undefined && !sameSide(sideOf(army), change.before);
}

/** What Revert does to one Army: delete a new one, or save it with its Before members back. */
export type ArmyRevert = { kind: "delete"; armyId: string } | { kind: "save"; army: ArmyRecord };

/**
 * Revert for one listed Army as it stands now, or `null` when it may not go back: the player has
 * edited it since (a revert would lose that) or deleted it.
 *
 * A member Before held that is still in the Army keeps its current snapshot, which a turn load may
 * have refreshed since; only the members that went come back as Before last saw them.
 */
export function armyRevert(change: AssistantArmyChange, current: ArmyRecord | undefined): ArmyRevert | null {
  if (current === undefined || !sameSide(sideOf(current), change.after)) {
    return null;
  }
  if (change.before === null) {
    return { kind: "delete", armyId: current.id };
  }
  const now = new Map(current.members.map((member) => [member.unitId, member]));
  const members = change.before.members.map((member) => now.get(member.unitId) ?? member);
  return { kind: "save", army: { ...current, name: change.before.name, members } };
}

/** One member as an entry reads it: "Riders (2301) · 12 men", another faction's naming its faction. */
export function memberLine(member: ArmyMemberRecord): string {
  const faction = member.own ? "" : factionPart(member);
  return `${member.name} (${member.unitId})${faction} · ${member.men} ${member.men === 1 ? "man" : "men"}`;
}

/** ", The Guardsmen (1)", or nothing when the report concealed the faction. */
function factionPart(member: ArmyMemberRecord): string {
  if (member.factionName !== null && member.factionId !== null) {
    return `, ${member.factionName} (${member.factionId})`;
  }
  const either = member.factionName ?? member.factionId;
  return either === null ? "" : `, ${either}`;
}

function unitsWord(count: number): string {
  return count === 1 ? "unit" : "units";
}

/** "new army · 9 units" for a new Army, "6 → 5 units" for a changed one (the plural follows After). */
export function armySummary(before: ArmySide | null, after: ArmySide): string {
  const count = after.members.length;
  return before === null
    ? `new army · ${count} ${unitsWord(count)}`
    : `${before.members.length} → ${count} ${unitsWord(count)}`;
}

/** One Army entry as the panel draws it. */
export type AssistantArmyChangeView = {
  armyId: string;
  /** The Army's name as it is now. */
  name: string;
  summary: string;
  /** True for an Army the assistant made, false for one it changed. */
  isNew: boolean;
  /** True when the Army is no longer what the assistant left. */
  edited: boolean;
  rows: AlignedOrderLine[];
  /** Before reads "no army". */
  beforeEmpty: boolean;
  /** After reads "no units". */
  afterEmpty: boolean;
};

/**
 * The comparison's rows. A new Army lists every member as added. A changed one lists the members
 * that went and came, a pair sharing a row in Army order, then one line for every member left alone.
 */
function memberRows(before: ArmySide | null, after: ArmySide): AlignedOrderLine[] {
  if (before === null) {
    return after.members.map((member) => ({ before: null, after: memberLine(member), changed: true }));
  }
  const kept = new Set(after.members.map((member) => member.unitId));
  const had = new Set(before.members.map((member) => member.unitId));
  const gone = before.members.filter((member) => !kept.has(member.unitId)).map(memberLine);
  const came = after.members.filter((member) => !had.has(member.unitId)).map(memberLine);
  const rows: AlignedOrderLine[] = Array.from({ length: Math.max(gone.length, came.length) }, (_, index) => ({
    before: gone[index] ?? null,
    after: came[index] ?? null,
    changed: true
  }));
  const unchanged = after.members.length - came.length;
  if (unchanged > 0) {
    const fold = `… ${unchanged} more unchanged`;
    rows.push({ before: fold, after: fold, changed: false });
  }
  return rows;
}

/**
 * The Army entries as they should be drawn, sorted by each Army's name as it is now. An Army deleted,
 * or already back to Before, is left out even before `settleAssistantArmyChanges` takes it off.
 */
export function assistantArmyViews(state: AssistantChangesState, armies: readonly ArmyRecord[]): AssistantArmyChangeView[] {
  const byId = new Map(armies.map((army) => [army.id, army]));
  return state.armies
    .flatMap((change) => {
      const army = byId.get(change.armyId);
      return army !== undefined && stillListed(change, army) ? [{ change, army }] : [];
    })
    .sort((a, b) => a.army.name.localeCompare(b.army.name) || a.army.id.localeCompare(b.army.id))
    .map(({ change, army }) => ({
      armyId: army.id,
      name: army.name,
      summary: armySummary(change.before, change.after),
      isNew: change.before === null,
      edited: !sameSide(sideOf(army), change.after),
      rows: memberRows(change.before, change.after),
      beforeEmpty: change.before === null,
      afterEmpty: change.after.members.length === 0
    }));
}
