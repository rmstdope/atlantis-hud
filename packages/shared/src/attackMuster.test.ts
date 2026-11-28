import { readFileSync } from "node:fs";
import { aReportUnit } from "@atlantis/core-client";
import { describe, expect, it } from "vitest";
import { lineWarning, readUnitAttackOrders, unitRole } from "./attackMuster";
import { parseGameData, type GameDataIndex } from "./gameData";

const doc = (...lines: string[]) => ["#atlantis 95", "", ...lines, "", "#end"].join("\n");

describe("reading a unit's attack and flag orders (rules/attack, rules/sequenceofevents)", () => {
  it("collects every target of every ATTACK line, repeated ones included", () => {
    const orders = readUnitAttackOrders(
      doc("unit 812", "ATTACK 1203", "@attack 1204 1205", "unit 815", "WORK"),
      "origins"
    );
    expect(orders.get("812")?.targets).toEqual(["1203", "1204", "1205"]);
    expect(orders.get("815")?.targets).toEqual([]);
  });

  it("reads the pre-combat flag orders, last one winning", () => {
    const orders = readUnitAttackOrders(
      doc("unit 820", "BEHIND 1", "AVOID 1", "AVOID 0", "HOLD 1", "NOAID 1", 'COMBAT "fire"'),
      "origins"
    );
    expect(orders.get("820")?.flags).toEqual({
      behind: true,
      avoid: false,
      hold: true,
      noAid: true,
      combatSpell: true
    });
  });

  it("leaves out comments, TURN blocks and FORM blocks, which are not this unit's month", () => {
    const orders = readUnitAttackOrders(
      doc(
        "unit 812",
        "; ATTACK 1",
        "TURN",
        "ATTACK 2",
        "BEHIND 1",
        "ENDTURN",
        "FORM 1",
        "ATTACK 3",
        "END",
        "ATTACK 4 ; the bandits"
      ),
      "origins"
    );
    expect(orders.get("812")).toEqual({ targets: ["4"], flags: {} });
  });
});

function shippedGameData(): GameDataIndex {
  const index = parseGameData(
    readFileSync(new URL("../../../config/public/ruleset.json", import.meta.url), "utf8")
  );
  if (index === null) {
    throw new Error("expected the shipped ruleset to parse");
  }
  return index;
}

const item = (tag: string, name: string, amount = 1) => ({ tag, name, amount });
const skill = (tag: string, name: string, level = 1) => ({ tag, name, level, points: 30 * level });

describe("a unit's main role in a fight", () => {
  const data = shippedGameData();

  it("is melee for a unit with a weapon that needs no skill (data/SWOR) or with Combat (data/COMB)", () => {
    expect(unitRole(aReportUnit({ items: [item("SWOR", "sword", 5)] }), false, data)).toBe("melee");
    expect(unitRole(aReportUnit({ skills: [skill("COMB", "combat")] }), false, data)).toBe("melee");
  });

  it("is ranged for a ranged weapon wielded with its skill (data/LBOW), and not without it", () => {
    const bow = [item("LBOW", "longbow", 5)];
    expect(
      unitRole(aReportUnit({ items: bow, skills: [skill("LBOW", "longbow")] }), false, data)
    ).toBe("ranged");
    expect(unitRole(aReportUnit({ items: bow }), false, data)).toBe("non-combatant");
  });

  it("is ranged for a javelin, which needs no skill (data/JAVE)", () => {
    expect(unitRole(aReportUnit({ items: [item("JAVE", "javelin")] }), false, data)).toBe("ranged");
  });

  it("is melee, ranged for a unit that can do both", () => {
    const unit = aReportUnit({
      items: [item("LBOW", "longbow")],
      skills: [skill("LBOW", "longbow"), skill("COMB", "combat")]
    });
    expect(unitRole(unit, false, data)).toBe("melee, ranged");
  });

  it("puts mage over tactician over fighter", () => {
    const fighter = { items: [item("SWOR", "sword")], skills: [skill("TACT", "tactics")] };
    expect(unitRole(aReportUnit(fighter), false, data)).toBe("tactician");
    expect(unitRole(aReportUnit(fighter), true, data)).toBe("mage");
    expect(
      unitRole(aReportUnit({ ...fighter, combatSpell: { name: "fire", tag: "FIRE" } }), false, data)
    ).toBe("mage");
  });

  it("is non-combatant with no weapon and no combat skill", () => {
    expect(unitRole(aReportUnit({ items: [item("HORS", "horse", 5)] }), false, data)).toBe(
      "non-combatant"
    );
  });

  it("knows Combat but no weapons without game data", () => {
    expect(unitRole(aReportUnit({ items: [item("SWOR", "sword")] }), false, null)).toBe(
      "non-combatant"
    );
    expect(unitRole(aReportUnit({ skills: [skill("COMB", "combat")] }), false, null)).toBe("melee");
  });
});

describe("a role that does not suit its line", () => {
  it("warns of melee in the backline, but not melee, ranged", () => {
    expect(lineWarning("melee", "backline")).toBe(
      "melee in the backline: cannot fight until the frontline falls"
    );
    expect(lineWarning("melee, ranged", "backline")).toBeNull();
    expect(lineWarning("melee", "frontline")).toBeNull();
  });

  it("warns of a non-combatant, a ranged unit, a mage or a tactician in the frontline", () => {
    expect(lineWarning("non-combatant", "frontline")).toBe(
      "non-combatant in the frontline: likely to be cut down"
    );
    for (const role of ["ranged", "mage", "tactician"] as const) {
      expect(lineWarning(role, "frontline")).toBe(
        `${role} in the frontline: could stand in the backline, safe until the frontline falls`
      );
      expect(lineWarning(role, "backline")).toBeNull();
    }
    expect(lineWarning("melee, ranged", "frontline")).toBeNull();
  });
});
