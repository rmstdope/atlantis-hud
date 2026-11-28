import { describe, expect, it } from "vitest";
import { readUnitAttackOrders } from "./attackMuster";

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
