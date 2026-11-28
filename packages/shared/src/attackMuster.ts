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

import type { ReportRegion, ReportUnit } from "@atlantis/core-client";
import { itemEntryId, terrainEntryId, type GameDataIndex } from "./gameData";
import { regionIdOf } from "./hexMapModel";
import { count } from "./plural";
import { lexOrderLine } from "./orderLine";
import { findUnitBlocks, thisMonthsOwnLines } from "./ordersDocument";
import type { OrderCommentSyntax } from "./rulesets";
import type { OwnDeclarations } from "./teachingPermission";

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

/** One unit of ours in the estimate, as a line of the window reads it. */
export type MusterUnit = {
  unitId: string;
  /** The hex the unit stands in, for going to it. */
  regionId: string;
  name: string;
  men: number;
  role: AttackRole;
  /** Dim text after the unit, in order; the view joins them. */
  reasons: string[];
  /** The amber warning, drawn with a "!" mark; null for none, and always null under Will not fight. */
  warning: string | null;
};

/** One attacking unit of ours and who of ours its attack would muster. */
export type AttackView = {
  /** The attacker's unit id: what the window's selection follows across edits. */
  key: string;
  attackerId: string;
  attackerName: string;
  regionId: string;
  /** The hex as "<Terrain> (<x>,<y>)". */
  hex: string;
  /** Every target, in order: "<Name> (<id>)", or "unit <id>" for one not in the hex. */
  targets: string[];
  /** Target ids the report does not show in the hex. */
  missingTargets: string[];
  /** Target factions we declare Ally, once each. */
  allies: { id: string; name: string }[];
  /** Every target the hex shows belongs to an ally, so our units withdraw and no groups are drawn. */
  withdraws: boolean;
  frontline: MusterUnit[];
  backline: MusterUnit[];
  out: MusterUnit[];
};

/** `rules/movement_normal`: the points each mode of travel has in a month. */
export type MovementPoints = { walk: number; ride: number; fly: number };

/**
 * The ruleset's movement points, or null when the text carries none. Read straight from the
 * ruleset text, as `waterTerrainsOf` reads the water terrains, because `GameDataIndex` keeps no
 * movement block of its own.
 */
export function movementPointsOf(rulesetText: string | null): MovementPoints | null {
  if (rulesetText === null) {
    return null;
  }
  try {
    const points = (JSON.parse(rulesetText) as { movement?: { movementPoints?: Partial<MovementPoints> } })
      .movement?.movementPoints;
    return typeof points?.walk === "number" && typeof points.ride === "number" && typeof points.fly === "number"
      ? { walk: points.walk, ride: points.ride, fly: points.fly }
      : null;
  } catch {
    return null;
  }
}

type Reach = "reaches" | "cannot" | "unknown";

/**
 * Whether a neighbour could reach the battle. `rules/com_muster`: "The computer checks for weight
 * allowances and terrain types ... the use of fleets is not allowed in this virtual movement." An
 * overloaded unit cannot move at all (`rules/movement_normal`); a water hex at either end would
 * need a fleet or a flight that must end on land, which this does not try to judge.
 */
function reachOf(
  unit: ReportUnit,
  from: ReportRegion,
  battle: ReportRegion,
  gameData: GameDataIndex | null,
  points: MovementPoints | null
): Reach {
  const status = unit.movement?.status;
  if (status === "overloaded") {
    return "cannot";
  }
  if (status === undefined || gameData === null || points === null) {
    return "unknown";
  }
  const movementOf = (region: ReportRegion) => {
    const detail = gameData.detailOf(terrainEntryId(region.terrain));
    return detail?.kind === "terrain" ? detail.movement : null;
  };
  const into = movementOf(battle);
  const leaving = movementOf(from);
  if (into === null || into.kind === "water" || leaving === null || leaving.kind === "water") {
    return "unknown";
  }
  return points[status] >= into[status] ? "reaches" : "cannot";
}

type UnitState = { avoid: boolean; behind: boolean; hold: boolean; noAid: boolean };

/** The unit's flags as combat finds them: the report's, overlaid by this month's flag orders. */
function stateOf(unit: ReportUnit, orders: UnitFlagOrders | undefined): UnitState {
  const has = (...words: string[]) => words.some((word) => unit.flags.includes(word));
  return {
    avoid: orders?.avoid ?? has("avoiding"),
    behind: orders?.behind ?? has("behind"),
    hold: orders?.hold ?? has("holding"),
    noAid: orders?.noAid ?? has("no aid", "receiving no aid")
  };
}

const AVOID_SET = "set by AVOID 1 in your orders";
const BEHIND_SET = "set by BEHIND 1 in your orders";

/**
 * Every ATTACK order of ours as a row of the Attacks window, in document order, each with the
 * units of ours its battle would muster.
 *
 * The rules, each from a lookup: every unit of the attacking faction in the hex joins except those
 * avoiding, and one that gives an ATTACK order joins regardless (`rules/com_muster`); units in
 * adjacent hexes join if they could reach it and are not avoiding, unless holding (`rules/hold`)
 * or every unit of ours on the side takes no aid (`rules/noaid`: "they must all have the NOAID flag
 * on"); behind units stand in the backline (`rules/behind`, `rules/com_thebattle`); attacking an
 * ally withdraws our units (`rules/com_muster`); and the attacker must see its target
 * (`rules/com_attacking`), which a target missing from the hex in this report puts in doubt.
 *
 * A unit with no men is left out: one formed this month is given its men after combat
 * (`rules/sequenceofevents`), and the report does not list it anyway.
 */
export function attacksInOrders(input: {
  regions: readonly ReportRegion[];
  ordersDocument: string;
  syntax: OrderCommentSyntax;
  declarations: OwnDeclarations;
  gameData: GameDataIndex | null;
  movementPoints: MovementPoints | null;
  hexLabel: (regionId: string) => string;
}): AttackView[] {
  const orders = readUnitAttackOrders(input.ordersDocument, input.syntax);
  const regionById = new Map(input.regions.map((region) => [region.regionId, region]));
  const ownUnit = new Map<string, { unit: ReportUnit; region: ReportRegion }>();
  for (const region of input.regions) {
    for (const unit of region.units) {
      if (unit.own) {
        ownUnit.set(unit.unitId, { unit, region });
      }
    }
  }

  const views: AttackView[] = [];
  for (const [attackerId, attack] of orders) {
    const found = ownUnit.get(attackerId);
    // An attacker with no men has nobody to fight with, and the hex's muster leaves it out too.
    if (attack.targets.length === 0 || found === undefined || found.unit.men <= 0) {
      continue;
    }
    // A target named twice is attacked once: the first mention keeps its place.
    views.push(viewOf(found.unit, found.region, [...new Set(attack.targets)]));
  }
  return views;

  function musterUnit(
    unit: ReportUnit,
    regionId: string,
    line: BattleLine | null,
    reasons: string[]
  ): MusterUnit {
    const role = unitRole(unit, orders.get(unit.unitId)?.flags.combatSpell === true, input.gameData);
    return {
      unitId: unit.unitId,
      regionId,
      name: unit.name,
      men: unit.men,
      role,
      reasons,
      warning: line === null ? null : lineWarning(role, line)
    };
  }

  function viewOf(attacker: ReportUnit, region: ReportRegion, targetIds: string[]): AttackView {
    const hex = input.hexLabel(region.regionId);
    const shown = new Map(region.units.map((unit) => [unit.unitId, unit]));
    const targets: string[] = [];
    const missingTargets: string[] = [];
    const allies = new Map<string, string>();
    let foreignTargets = 0;
    for (const id of targetIds) {
      const target = shown.get(id);
      if (target === undefined) {
        targets.push(`unit ${id}`);
        missingTargets.push(id);
        continue;
      }
      targets.push(`${target.name} (${id})`);
      if (target.factionId === null || target.own) {
        continue;
      }
      foreignTargets += 1;
      const attitude =
        input.declarations.toward.get(target.factionId) ?? input.declarations.fallback;
      if (attitude === "ally") {
        allies.set(target.factionId, target.factionName ?? `faction ${target.factionId}`);
      }
    }
    // Only when every target the hex shows is known to be an ally's: one whose faction the report
    // hides may well be fought, so the groups stay.
    const withdraws =
      foreignTargets > 0 &&
      targetIds.every((id) => {
        const target = shown.get(id);
        return target === undefined || (target.factionId !== null && allies.has(target.factionId));
      });

    const frontline: MusterUnit[] = [];
    const backline: MusterUnit[] = [];
    const out: MusterUnit[] = [];
    const join = (unit: ReportUnit, regionId: string, state: UnitState, reasons: string[]) => {
      const flags = orders.get(unit.unitId)?.flags;
      const line: BattleLine = state.behind ? "backline" : "frontline";
      if (line === "backline" && flags?.behind === true) {
        reasons.push(BEHIND_SET);
      }
      (line === "backline" ? backline : frontline).push(musterUnit(unit, regionId, line, reasons));
    };

    // The battle hex.
    const joiners: UnitState[] = [];
    for (const unit of region.units) {
      if (!unit.own || unit.men <= 0) {
        continue;
      }
      const flags = orders.get(unit.unitId)?.flags;
      const state = stateOf(unit, flags);
      const attacks = unit.unitId === attacker.unitId || (orders.get(unit.unitId)?.targets.length ?? 0) > 0;
      if (attacks) {
        joiners.push(state);
        join(unit, region.regionId, state, [
          state.avoid ? "gave the order, so it fights although it is avoiding" : "gave the order"
        ]);
      } else if (state.avoid) {
        out.push(musterUnit(unit, region.regionId, null, [flags?.avoid === true ? `avoiding — ${AVOID_SET}` : "avoiding"]));
      } else {
        joiners.push(state);
        join(unit, region.regionId, state, []);
      }
    }
    const noAid = joiners.length > 0 && joiners.every((state) => state.noAid);

    // The neighbours.
    for (const exit of region.exits) {
      const neighbour = regionById.get(regionIdOf(exit.coordinate));
      if (neighbour === undefined) {
        continue;
      }
      const there = input.hexLabel(neighbour.regionId);
      for (const unit of neighbour.units) {
        if (!unit.own || unit.men <= 0) {
          continue;
        }
        const flags = orders.get(unit.unitId)?.flags;
        const state = stateOf(unit, flags);
        if (state.avoid) {
          const why = flags?.avoid === true ? `in ${there}, avoiding — ${AVOID_SET}` : `in ${there}, avoiding`;
          out.push(musterUnit(unit, neighbour.regionId, null, [why]));
          continue;
        }
        if (state.hold) {
          out.push(musterUnit(unit, neighbour.regionId, null, [`in ${there}, holding`]));
          continue;
        }
        if (noAid) {
          out.push(musterUnit(unit, neighbour.regionId, null, [`in ${there} — none of your units in ${hex} will take aid`]));
          continue;
        }
        const reach = reachOf(unit, neighbour, region, input.gameData, input.movementPoints);
        if (reach === "cannot") {
          out.push(musterUnit(unit, neighbour.regionId, null, [`in ${there}, cannot reach the battle`]));
          continue;
        }
        join(unit, neighbour.regionId, state, [reach === "reaches" ? `from ${there}` : `from ${there}, if they can reach the battle`]);
      }
    }

    return {
      key: attacker.unitId,
      attackerId: attacker.unitId,
      attackerName: attacker.name,
      regionId: region.regionId,
      hex,
      targets,
      missingTargets,
      allies: [...allies].map(([id, name]) => ({ id, name })),
      withdraws,
      frontline,
      backline,
      out
    };
  }
}

/* --- the window's words, exactly as the acceptance gives them --- */

export type MusterGroup = "frontline" | "backline" | "out";

const GROUP_NAMES: Readonly<Record<MusterGroup, string>> = {
  frontline: "Frontline",
  backline: "Backline",
  out: "Will not fight"
};

/** The header chip: "1 attack" / "N attacks". */
export function attackChipText(attacks: number): string {
  return count(attacks, "attack");
}

/** The window's bar: "Attacks · N in your orders", or "none" once the last one is deleted. */
export function attacksBarText(attacks: number): string {
  return `Attacks · ${attacks === 0 ? "none" : attacks} in your orders`;
}

/** "Frontline — 6 units, 87 men"; an empty group reads "<Group> — none". */
export function groupHeading(group: MusterGroup, units: readonly MusterUnit[]): string {
  if (units.length === 0) {
    return `${GROUP_NAMES[group]} — none`;
  }
  const men = units.reduce((sum, unit) => sum + unit.men, 0);
  return `${GROUP_NAMES[group]} — ${count(units.length, "unit")}, ${count(men, "man", "men")}`;
}

/** "Raiders (812) · 20 men · melee, ranged". */
/** The unit's line in the pieces the window styles apart (ah-wlia8): "Raiders", "(812)", "20 men", the role. */
export function unitLineParts(unit: MusterUnit): { name: string; number: string; men: string; role: string } {
  return { name: unit.name, number: `(${unit.unitId})`, men: count(unit.men, "man", "men"), role: unit.role };
}

type Named = Pick<AttackView, "attackerId" | "attackerName" | "hex" | "targets">;

/** The list row: "Raiders (812) → Bandits (1203), Bandits (1204)". */
export function attackRowText(view: Named): string {
  return `${view.attackerName} (${view.attackerId}) → ${view.targets.join(", ")}`;
}

/** The detail's title: "Raiders (812) attacks Bandits (1203), Bandits (1204)". */
export function attackTitleText(view: Named): string {
  return `${view.attackerName} (${view.attackerId}) attacks ${view.targets.join(", ")}`;
}

/** The red banner for a target faction we declare Ally. */
export function allyBannerText(faction: { id: string; name: string }): string {
  return `You have declared ${faction.name} (${faction.id}) an ally. Your units will withdraw instead of attacking them.`;
}

/** The amber banner for a target the report does not show in the hex. */
export function missingTargetBannerText(targetId: string, view: Named): string {
  return `Unit ${targetId} is not in ${view.hex} in this report. The attack happens only if ${view.attackerName} can see it there.`;
}
