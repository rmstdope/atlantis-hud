/**
 * Who of ours would join an attack the orders hold, estimated before the orders are sent (ah-pbyfh).
 *
 * Pure, and in `packages/shared` because the package has no jsdom (ah-nass): every rule and every
 * string the Attacks window shows is decided here, and `AttacksDialog` only draws it.
 *
 * An estimate from the report plus this turn's own orders. `rules/sequenceofevents` processes
 * AVOID, BEHIND, HOLD, NOAID, COMBAT and DECLARE before combat, and combat before ATTACK, so those
 * orders are read as already in force; GIVE, BUY and MOVE come after, so men, items and position
 * are the report's.
 */

import type { ReportUnit } from "@atlantis/core-client";
import { itemEntryId, type GameDataIndex } from "./gameData";
import { lexOrderLine } from "./orderLine";
import { findUnitBlocks, thisMonthsOwnLines } from "./ordersDocument";
import type { OrderCommentSyntax } from "./rulesets";

/** What one unit's own orders this month set, where they set it. Absent means "left alone". */
export type UnitFlagOrders = {
  avoid?: boolean;
  behind?: boolean;
  hold?: boolean;
  noAid?: boolean;
  /** A `COMBAT <spell>` this month (`rules/combat`). */
  combatSpell?: boolean;
};

export type UnitAttackOrders = { targets: string[]; flags: UnitFlagOrders };

const FLAG_ORDERS: Readonly<Record<string, keyof UnitFlagOrders>> = {
  AVOID: "avoid",
  BEHIND: "behind",
  HOLD: "hold",
  NOAID: "noAid"
};

/** `rules/avoid` and the others take `[flag]`: 1 sets it, 0 cancels it. Anything else is ignored. */
function flagValue(word: string | undefined): boolean | null {
  return word === "1" ? true : word === "0" ? false : null;
}

/**
 * Every unit block's ATTACK targets (`rules/attack`: "If multiple ATTACK orders are given, all of
 * the targets will be attacked") and the flag orders it gives, keyed by unit id.
 *
 * Only the unit's own month counts: a `FORM` block is the new unit's, and a `TURN` block runs in a
 * later month (`rules/form`, `rules/turn`).
 */
export function readUnitAttackOrders(
  document: string,
  syntax: OrderCommentSyntax
): Map<string, UnitAttackOrders> {
  const lines = document.split("\n");
  const result = new Map<string, UnitAttackOrders>();
  for (const block of findUnitBlocks(document, syntax)) {
    const body = lines.slice(block.firstLine, block.lastLine + 1).join("\n");
    const entry: UnitAttackOrders = result.get(block.unitId) ?? { targets: [], flags: {} };
    for (const line of thisMonthsOwnLines(body, syntax)) {
      const [command, ...args] = lexOrderLine(line, syntax).tokens;
      const upper = command?.toUpperCase();
      if (upper === undefined) {
        continue;
      }
      if (upper === "ATTACK") {
        entry.targets.push(...args);
        continue;
      }
      if (upper === "COMBAT") {
        entry.flags.combatSpell = args.length > 0;
        continue;
      }
      const flag = FLAG_ORDERS[upper];
      const value = flagValue(args[0]);
      if (flag !== undefined && value !== null) {
        entry.flags[flag] = value;
      }
    }
    result.set(block.unitId, entry);
  }
  return result;
}

/** One main role per unit; a unit that both melees and shoots is "melee, ranged". */
export type AttackRole = "melee" | "ranged" | "mage" | "tactician" | "non-combatant" | "melee, ranged";

/** Where a joining unit stands: `rules/com_thebattle` and `rules/behind`. */
export type BattleLine = "frontline" | "backline";

/** `data/LBOW`'s opening words for every ranged weapon. */
const RANGED = /^This is a ranged /iu;
/** The scraper's own wield sentence (`packages/ruleset/src/data.ts`, `WIELD_SKILL`). */
const WIELD_SKILL = /Knowledge of [a-z ]+ \[([A-Z]{2,6})\] is needed to wield this weapon\./iu;
const WIELD_NONE = /No skill is needed to wield this weapon\./iu;

type Wielded = "melee" | "ranged" | null;

/**
 * What one carried item lets the unit fight with: nothing, unless it is a weapon (its description
 * carries a wield sentence) and the unit knows any skill it needs (`data/LBOW`: "Knowledge of
 * longbow [LBOW] is needed to wield this weapon").
 */
function wieldedWith(tag: string, unit: ReportUnit, gameData: GameDataIndex): Wielded {
  const id = itemEntryId(gameData, tag);
  const detail = id === null ? null : gameData.detailOf(id);
  const description = detail?.kind === "item" ? (detail.description ?? "") : "";
  const needs = WIELD_SKILL.exec(description)?.[1] ?? null;
  if (needs === null && !WIELD_NONE.test(description)) {
    return null;
  }
  if (needs !== null && !unit.skills.some((known) => known.tag === needs && known.level > 0)) {
    return null;
  }
  return RANGED.test(description) ? "ranged" : "melee";
}

const knows = (unit: ReportUnit, tag: string) =>
  unit.skills.some((known) => known.tag === tag && known.level > 0);

/**
 * A unit's main role: mage over tactician over fighter, as agreed with the team.
 *
 * Mage is a combat spell set, in the report or by a COMBAT order this month (`rules/combat`);
 * tactician knows Tactics (`data/TACT`); melee holds a weapon it can wield that is not ranged, or
 * knows Combat (`data/COMB`); ranged holds a ranged weapon it can wield. With no game data no
 * weapon can be told, so only Combat makes a fighter.
 */
export function unitRole(
  unit: ReportUnit,
  spellOrdered: boolean,
  gameData: GameDataIndex | null
): AttackRole {
  if (spellOrdered || unit.combatSpell !== null) {
    return "mage";
  }
  if (knows(unit, "TACT")) {
    return "tactician";
  }
  const wielded = new Set<Wielded>(
    gameData === null ? [] : unit.items.map((held) => wieldedWith(held.tag, unit, gameData))
  );
  const melee = wielded.has("melee") || knows(unit, "COMB");
  const ranged = wielded.has("ranged");
  return melee && ranged ? "melee, ranged" : melee ? "melee" : ranged ? "ranged" : "non-combatant";
}

const SAFER_BEHIND = "could stand in the backline, safe until the frontline falls";

/** The amber warning a role earns on its line, or null where the role suits it. */
export function lineWarning(role: AttackRole, line: BattleLine): string | null {
  if (line === "backline") {
    return role === "melee" ? "melee in the backline: cannot fight until the frontline falls" : null;
  }
  switch (role) {
    case "non-combatant":
      return "non-combatant in the frontline: likely to be cut down";
    case "ranged":
    case "mage":
    case "tactician":
      return `${role} in the frontline: ${SAFER_BEHIND}`;
    default:
      return null;
  }
}
