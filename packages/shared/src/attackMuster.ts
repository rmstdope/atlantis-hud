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
