/**
 * Armies: named groups of units the player assembles by hand, scoped to the game.
 *
 * Storage-only, first of the ah-1mpx family. This is the pure module the units dock's source rail
 * (ah-1mpx.2) will call; it holds the rules for an Army's shape and for the one piece of real
 * logic here — refreshing a member's snapshot against a loaded turn.
 *
 * A member the current report does not mention is **kept**, and is still exported: it may be
 * another faction's unit that is simply not visible this turn. So a membership is not a unit
 * number but a snapshot of the unit as it was last seen, refreshed whenever that unit turns up in
 * a report again.
 *
 * Ordering is `@atlantis/core-client`'s (`sortArmies`, re-exported below), and storage is reached
 * only through `CoreClient`, the way `hexNotes.ts` does.
 */

import {
  sortArmies as sortArmiesFromClient,
  type ArmyMemberRecord,
  type ArmyRecord,
  type CoreClient,
  type OpenedGame,
  type ParsedReport,
  type ReportUnit
} from "@atlantis/core-client";

export type { ArmyMemberRecord, ArmyRecord };

/** A game's Armies by name, then id: the client's order, which every list and mutation shares. */
export const sortArmies = sortArmiesFromClient;

/**
 * One unit, as an Army will remember it: a straight copy of what the report showed.
 *
 * `menEstimated` is deliberately not copied. The export never consults it, and a snapshot that
 * carried it would invite a later reader to branch on a fact about a parse that happened turns ago.
 */
export function snapshotOf(unit: ReportUnit, turn: number, now: string): ArmyMemberRecord {
  return {
    unitId: unit.unitId,
    name: unit.name,
    factionId: unit.factionId,
    factionName: unit.factionName,
    own: unit.own,
    regionId: unit.regionId,
    flags: [...unit.flags],
    items: unit.items.map((item) => ({ ...item })),
    skills: unit.skills.map((skill) => ({ ...skill })),
    combatSpell: unit.combatSpell === null ? null : { ...unit.combatSpell },
    men: unit.men,
    seenTurn: turn,
    seenAt: now
  };
}

/** Trimmed name, or `null` when it trims to empty — the caller decides what to say. */
function normalizeArmyName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** A new Army: fresh id, trimmed name, no members. Throws when the name trims to empty. */
export function newArmy(args: { gameId: string; name: string; now: string }): ArmyRecord {
  const name = normalizeArmyName(args.name);
  if (name === null) {
    throw new Error("an Army's name cannot be empty");
  }

  return {
    id: crypto.randomUUID(),
    gameId: args.gameId,
    name,
    members: [],
    createdAt: args.now,
    updatedAt: args.now
  };
}

/** Same Army under a new name. `id`, `createdAt` and `members` are untouched. */
export function renameArmy(army: ArmyRecord, name: string, now: string): ArmyRecord {
  const trimmed = normalizeArmyName(name);
  if (trimmed === null) {
    throw new Error("an Army's name cannot be empty");
  }

  return { ...army, name: trimmed, updatedAt: now };
}

/** Adds the unit, or replaces its snapshot if it is already a member. */
export function withMember(
  army: ArmyRecord,
  unit: ReportUnit,
  turn: number,
  now: string
): ArmyRecord {
  const snapshot = snapshotOf(unit, turn, now);
  const existing = army.members.findIndex((member) => member.unitId === unit.unitId);
  const members =
    existing === -1
      ? [...army.members, snapshot]
      : army.members.map((member, index) => (index === existing ? snapshot : member));

  return { ...army, members, updatedAt: now };
}

/** Removes one member by unit number. Returns the same object when it was not a member. */
export function withoutMember(army: ArmyRecord, unitId: string, now: string): ArmyRecord {
  const members = army.members.filter((member) => member.unitId !== unitId);
  if (members.length === army.members.length) {
    return army;
  }

  return { ...army, members, updatedAt: now };
}

/** Every unit in the report, by unit number — built once and reused across Armies. */
export function unitsByIdIn(parsed: ParsedReport): Map<string, ReportUnit> {
  const byId = new Map<string, ReportUnit>();
  for (const region of parsed.regions) {
    for (const unit of region.units) {
      byId.set(unit.unitId, unit);
    }
  }
  return byId;
}

/**
 * Refreshed against a loaded turn.
 *
 * Three rules, each of which is a bug if it is missed:
 *
 * 1. **Never refresh backwards.** A member whose snapshot is already from a later turn than this
 *    one is skipped: loading an older turn for comparison must not overwrite what we know now.
 * 2. **The same object comes back when nothing changed**, so a caller can save only what moved —
 *    without which every turn load rewrites every Army.
 * 3. **Absent means absent, not gone.** A member the report does not mention keeps its snapshot
 *    untouched; there is no tombstone and no removal. Removing is the player's (ah-1mpx.2).
 */
export function refreshedAgainst(
  army: ArmyRecord,
  units: ReadonlyMap<string, ReportUnit>,
  turn: number,
  now: string
): ArmyRecord {
  let changed = false;
  const members = army.members.map((member) => {
    const unit = units.get(member.unitId);
    if (unit === undefined || member.seenTurn > turn) {
      return member;
    }

    const snapshot = snapshotOf(unit, turn, now);
    if (sameSnapshot(member, snapshot)) {
      return member;
    }

    changed = true;
    return snapshot;
  });

  return changed ? { ...army, members, updatedAt: now } : army;
}

/**
 * Whether two snapshots say the same thing about a unit.
 *
 * `seenAt` is excluded on purpose: it is the clock, not the unit, so a report that showed nothing
 * new must not count as a change and must not cost a write. Field by field rather than by
 * stringifying the whole record, because one side has been through storage and the other has not,
 * and two JSON documents with the same fields in a different order are not the same text.
 */
function sameSnapshot(a: ArmyMemberRecord, b: ArmyMemberRecord): boolean {
  return (
    a.unitId === b.unitId &&
    a.name === b.name &&
    a.factionId === b.factionId &&
    a.factionName === b.factionName &&
    a.own === b.own &&
    a.regionId === b.regionId &&
    a.men === b.men &&
    a.seenTurn === b.seenTurn &&
    sameList(a.flags, b.flags, (one, other) => one === other) &&
    sameList(
      a.items,
      b.items,
      (one, other) => one.tag === other.tag && one.name === other.name && one.amount === other.amount
    ) &&
    sameList(
      a.skills,
      b.skills,
      (one, other) =>
        one.tag === other.tag &&
        one.name === other.name &&
        one.level === other.level &&
        one.points === other.points
    ) &&
    sameCombatSpell(a.combatSpell, b.combatSpell)
  );
}

/**
 * Whether two snapshots name the same combat spell.
 *
 * Compared rather than ignored on purpose: `sameSnapshot` decides whether a turn load rewrites an
 * Army, so a field it does not read is a field that never refreshes - a mage who switches from
 * `force shield` to `fire` would keep exporting the shield for ever.
 */
function sameCombatSpell(
  a: ArmyMemberRecord["combatSpell"],
  b: ArmyMemberRecord["combatSpell"]
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.tag === b.tag && a.name === b.name;
}

function sameList<T>(a: readonly T[], b: readonly T[], same: (one: T, other: T) => boolean): boolean {
  return a.length === b.length && a.every((one, index) => same(one, b[index]));
}

/** True when this member's snapshot is older than the turn on screen. */
export function memberIsStale(member: ArmyMemberRecord, currentTurn: number): boolean {
  return member.seenTurn < currentTurn;
}

/** A game's Armies, sorted by name. */
export async function loadArmies(client: CoreClient, game: OpenedGame): Promise<ArmyRecord[]> {
  const armies = await client.listArmies(game.databasePath, game.manifest.metadata.gameId);
  return sortArmies(armies);
}

/** Inserts or updates one Army. */
export async function saveArmy(
  client: CoreClient,
  game: OpenedGame,
  army: ArmyRecord
): Promise<ArmyRecord> {
  return client.saveArmy(game.databasePath, army);
}

/** Deletes one Army. */
export async function deleteArmy(
  client: CoreClient,
  game: OpenedGame,
  armyId: string
): Promise<void> {
  await client.deleteArmy(game.databasePath, game.manifest.metadata.gameId, armyId);
}
